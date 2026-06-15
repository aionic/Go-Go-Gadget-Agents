import { NextRequest } from "next/server";
import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
import { getSession } from "@/lib/auth-session";

// Foundry agents run server-side (Node) so the managed-identity credential
// never reaches the browser. The Container App's user-assigned identity is
// selected via AZURE_CLIENT_ID.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  messages: ChatMessage[];
  thread_id?: string | null;
}

const PROJECT_ENDPOINT = process.env.FOUNDRY_PROJECT_ENDPOINT ?? "";
const AGENT_ID = process.env.FOUNDRY_AGENT_ID ?? "";
// Display name of the primary/orchestrator (router) agent.
const AGENT_NAME = process.env.FOUNDRY_AGENT_NAME || "Agent";
// Sub-agent display names — resolved to ids by name at runtime.
const RESEARCHER_NAME = "Researcher";
const WRITER_NAME = "Writer";
// When set, stream a scripted multi-agent handoff sequence so the UI/UX can be
// demonstrated without a live Foundry multi-agent backend.
const DEMO_MULTI_AGENT = process.env.DEMO_MULTI_AGENT === "true";

// Lazily construct the client so build-time (no env) doesn't throw.
let _project: AIProjectClient | null = null;
function getProject(): AIProjectClient {
  if (!_project) {
    _project = new AIProjectClient(
      PROJECT_ENDPOINT,
      new DefaultAzureCredential()
    );
  }
  return _project;
}

function sse(data: unknown): string {
  return `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;
}

export async function POST(request: NextRequest) {
  // Gate on the Entra session cookie (sign-in is identity-only).
  const sessionId = request.cookies.get("session_id")?.value;
  if (!sessionId || !getSession(sessionId)) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!DEMO_MULTI_AGENT && (!PROJECT_ENDPOINT || !AGENT_ID)) {
    return new Response(
      JSON.stringify({
        error:
          "Foundry not configured. Set FOUNDRY_PROJECT_ENDPOINT and FOUNDRY_AGENT_ID (or DEMO_MULTI_AGENT=true).",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const lastUser = [...(body.messages ?? [])]
    .reverse()
    .find((m) => m.role === "user");
  if (!lastUser?.content?.trim()) {
    return new Response(JSON.stringify({ error: "No user message" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();

  // Scripted multi-agent demo — visualises planner → researcher → writer
  // handoffs without a live multi-agent backend.
  if (DEMO_MULTI_AGENT) {
    const demoThread = body.thread_id || `demo-${crypto.randomUUID()}`;
    const stream = demoStream(encoder, demoThread, lastUser.content);
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) =>
        controller.enqueue(encoder.encode(sse(data)));

      try {
        const project = getProject();
        const agents = project.agents;
        const ids = await resolveAgentIds(agents);
        const researcherId = ids[RESEARCHER_NAME];
        const writerId = ids[WRITER_NAME];

        // Conversation thread (Cosmos-backed by Foundry) for the router turn.
        let threadId = body.thread_id ?? "";
        if (!threadId) {
          const thread = await agents.threads.create();
          threadId = thread.id;
        }

        send({ type: "start", thread_id: threadId });
        // The Planner runs first as a router: decide direct vs pipeline.
        send({ type: "agent_start", agent: AGENT_NAME });

        await agents.messages.create(threadId, "user", lastUser.content);
        const routerRaw = await runAgentText(agents, threadId, AGENT_ID);
        const decision = parseDecision(routerRaw);

        if (decision.mode === "pipeline" && researcherId && writerId) {
          // --- Multi-agent pipeline: only when the request warrants it. ---
          const brief = decision.brief || lastUser.content;

          // 1) Researcher gathers structured findings (buffered).
          send({
            type: "agent_handoff",
            from: AGENT_NAME,
            to: RESEARCHER_NAME,
            reason: "Gather supporting facts",
          });
          send({
            type: "tool_running",
            agent: RESEARCHER_NAME,
            name: "research",
            call_id: "research",
          });
          const rThread = (await agents.threads.create()).id;
          await agents.messages.create(
            rThread,
            "user",
            `User request:\n${lastUser.content}\n\nPlanner brief:\n${brief}`
          );
          const findings = await runAgentText(agents, rThread, researcherId);
          send({ type: "tool_done", call_id: "research" });

          // 2) Writer composes the final answer (streamed to the client).
          send({
            type: "agent_handoff",
            from: RESEARCHER_NAME,
            to: WRITER_NAME,
            reason: "Compose the final answer",
          });
          const wThread = (await agents.threads.create()).id;
          await agents.messages.create(
            wThread,
            "user",
            `User request:\n${lastUser.content}\n\nResearcher findings:\n${findings}`
          );
          await runAgentText(agents, wThread, writerId, (chunk) =>
            send({ type: "text_delta", agent: WRITER_NAME, content: chunk })
          );
        } else {
          // --- Direct answer: the Planner already handled a simple request. ---
          const answer = (decision.answer ?? routerRaw).trim();
          const CHUNK = 24;
          for (let i = 0; i < answer.length; i += CHUNK) {
            send({
              type: "text_delta",
              agent: AGENT_NAME,
              content: answer.slice(i, i + CHUNK),
            });
          }
        }

        controller.enqueue(encoder.encode(sse("[DONE]")));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(sse({ type: "error", message })));
        controller.enqueue(encoder.encode(sse("[DONE]")));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

// Resolve sub-agent ids (Researcher/Writer) by display name, cached for the
// lifetime of the server process. The orchestration is client-side now, so we
// look the ids up rather than threading them through env vars.
let _agentIdsByName: Record<string, string> | null = null;
async function resolveAgentIds(
  agents: AIProjectClient["agents"]
): Promise<Record<string, string>> {
  if (_agentIdsByName) return _agentIdsByName;
  const map: Record<string, string> = {};
  const list = (
    agents as unknown as {
      listAgents: () => AsyncIterable<{ id: string; name?: string }>;
    }
  ).listAgents();
  for await (const agent of list) {
    if (agent.name) map[agent.name] = agent.id;
  }
  _agentIdsByName = map;
  return map;
}

// Run an agent to completion on a thread, accumulating its assistant text.
// `onDelta` (when provided) streams each text chunk to the client.
async function runAgentText(
  agents: AIProjectClient["agents"],
  threadId: string,
  agentId: string,
  onDelta?: (chunk: string) => void
): Promise<string> {
  const events = await agents.runs.create(threadId, agentId).stream();
  let text = "";
  for await (const event of events as AsyncIterable<{
    event: string;
    data: unknown;
  }>) {
    if (event.event === "thread.message.delta") {
      const delta = event.data as {
        delta?: {
          content?: Array<{ type: string; text?: { value?: string } }>;
        };
      };
      const chunk = (delta.delta?.content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text?.value ?? "")
        .join("");
      if (chunk) {
        text += chunk;
        onDelta?.(chunk);
      }
    } else if (event.event === "thread.run.failed") {
      const run = event.data as { last_error?: { message?: string } };
      throw new Error(run.last_error?.message ?? "Agent run failed");
    } else if (event.event === "error") {
      const err = event.data as { message?: string };
      throw new Error(err.message ?? "Stream error");
    }
  }
  return text;
}

// Parse the Planner router's JSON decision, tolerating code fences / stray text.
function parseDecision(raw: string): {
  mode: "direct" | "pipeline";
  answer?: string;
  brief?: string;
} {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    const o = JSON.parse(s) as {
      mode?: string;
      answer?: unknown;
      brief?: unknown;
    };
    if (o.mode === "pipeline") {
      return {
        mode: "pipeline",
        brief: typeof o.brief === "string" ? o.brief : undefined,
      };
    }
    if (o.mode === "direct") {
      return {
        mode: "direct",
        answer: typeof o.answer === "string" ? o.answer : undefined,
      };
    }
  } catch {
    // fall through — treat the raw text as a direct answer
  }
  return { mode: "direct", answer: raw.trim() };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Scripted planner → researcher → writer handoff demo. Emits the same SSE
// contract as the live Foundry path so the UI renders the real flow.
function demoStream(
  encoder: TextEncoder,
  threadId: string,
  userText: string
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) =>
        controller.enqueue(encoder.encode(sse(data)));
      const type = async (agent: string, text: string, chunk = 18) => {
        for (let i = 0; i < text.length; i += chunk) {
          send({ type: "text_delta", agent, content: text.slice(i, i + chunk) });
          await sleep(40);
        }
      };

      try {
        send({ type: "start", thread_id: threadId });

        // 1) Planner
        send({ type: "agent_start", agent: "Planner" });
        await sleep(200);
        await type(
          "Planner",
          `Breaking down the request: "${userText.slice(0, 80)}". I'll plan the steps and route to specialists.\n\n`
        );
        send({ type: "tool_running", agent: "Planner", name: "build_plan", call_id: "c1" });
        await sleep(500);
        send({ type: "tool_done", call_id: "c1" });

        // 2) Handoff → Researcher
        send({ type: "agent_handoff", from: "Planner", to: "Researcher", reason: "Gather supporting data" });
        await sleep(200);
        await type("Researcher", "Searching the knowledge base and retrieving relevant documents…\n\n");
        send({ type: "tool_running", agent: "Researcher", name: "knowledge_search", call_id: "c2" });
        await sleep(700);
        send({ type: "tool_done", call_id: "c2" });
        await type("Researcher", "Found 3 relevant sources. Handing findings to the writer.\n\n");

        // 3) Handoff → Writer
        send({ type: "agent_handoff", from: "Researcher", to: "Writer", reason: "Compose the final answer" });
        await sleep(200);
        await type(
          "Writer",
          "## Summary\n\nHere's the synthesized answer based on the plan and research:\n\n- **Finding 1** — key insight from the sources\n- **Finding 2** — supporting detail\n- **Next step** — recommended action\n\nLet me know if you'd like this expanded."
        );

        controller.enqueue(encoder.encode(sse("[DONE]")));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(sse({ type: "error", message })));
        controller.enqueue(encoder.encode(sse("[DONE]")));
      } finally {
        controller.close();
      }
    },
  });
}
