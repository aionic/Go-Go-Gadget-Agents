import { NextRequest } from "next/server";
import { DefaultAzureCredential, type AccessToken } from "@azure/identity";
import { getSession } from "@/lib/auth-session";

// Foundry hosted agents are invoked server-side (Node) via the OpenAI Responses
// protocol so the managed-identity credential never reaches the browser. The
// Container App's user-assigned identity is selected via AZURE_CLIENT_ID.
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

const PROJECT_ENDPOINT = (process.env.FOUNDRY_PROJECT_ENDPOINT ?? "").replace(
  /\/$/,
  ""
);
// Hosted-agent names (Responses protocol). Override via env if renamed.
const PLANNER_AGENT = process.env.PLANNER_AGENT_NAME || "ggga-planner";
const RESEARCHER_AGENT = process.env.RESEARCHER_AGENT_NAME || "ggga-researcher";
const WRITER_AGENT = process.env.WRITER_AGENT_NAME || "ggga-writer";
// Display names surfaced to the UI for the handoff visualisation.
const PLANNER_LABEL = "Planner";
const RESEARCHER_LABEL = "Researcher";
const WRITER_LABEL = "Writer";
// When set, stream a scripted multi-agent handoff sequence so the UI/UX can be
// demonstrated without a live Foundry backend.
const DEMO_MULTI_AGENT = process.env.DEMO_MULTI_AGENT === "true";

// Data-plane scope for Foundry agent Responses endpoints.
const AI_SCOPE = "https://ai.azure.com/.default";

function sse(data: unknown): string {
  return `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;
}

// ── Auth: cache a Foundry data-plane token across requests. ──
let _credential: DefaultAzureCredential | null = null;
let _token: AccessToken | null = null;
function getCredential(): DefaultAzureCredential {
  if (!_credential) _credential = new DefaultAzureCredential();
  return _credential;
}
async function getToken(): Promise<string> {
  // Refresh when missing or within 5 minutes of expiry.
  if (!_token || _token.expiresOnTimestamp - Date.now() < 5 * 60 * 1000) {
    _token = await getCredential().getToken(AI_SCOPE);
    if (!_token) throw new Error("Failed to acquire Foundry access token");
  }
  return _token.token;
}

function responsesUrl(agentName: string): string {
  return `${PROJECT_ENDPOINT}/agents/${agentName}/endpoint/protocols/openai/responses?api-version=v1`;
}

// Invoke a hosted agent and return its full assistant text (non-streaming).
async function invokeAgent(agentName: string, input: string): Promise<string> {
  const res = await fetch(responsesUrl(agentName), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input, stream: false }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${agentName} responded ${res.status}: ${body}`);
  }
  const json = (await res.json()) as {
    output?: Array<{
      type: string;
      content?: Array<{ type: string; text?: string }>;
    }>;
  };
  const message = (json.output ?? []).find((o) => o.type === "message");
  return (message?.content ?? [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text ?? "")
    .join("");
}

// Invoke a hosted agent and stream its assistant text deltas via `onDelta`.
async function streamAgent(
  agentName: string,
  input: string,
  onDelta: (chunk: string) => void
): Promise<string> {
  const res = await fetch(responsesUrl(agentName), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input, stream: true }),
  });
  if (!res.ok || !res.body) {
    const body = res.body ? await res.text() : "";
    throw new Error(`${agentName} responded ${res.status}: ${body}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const evt of events) {
      for (const line of evt.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let parsed: { type?: string; delta?: string };
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        if (parsed.type === "response.output_text.delta" && parsed.delta) {
          full += parsed.delta;
          onDelta(parsed.delta);
        }
      }
    }
  }
  return full;
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

  if (!DEMO_MULTI_AGENT && !PROJECT_ENDPOINT) {
    return new Response(
      JSON.stringify({
        error:
          "Foundry not configured. Set FOUNDRY_PROJECT_ENDPOINT (or DEMO_MULTI_AGENT=true).",
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
        // Hosted agents are stateless (store:false); the thread id is a
        // client-side conversation handle for the UI to resume rendering.
        const threadId = body.thread_id || `thread-${crypto.randomUUID()}`;
        send({ type: "start", thread_id: threadId });

        // 1) Planner runs as a router: decide direct answer vs. pipeline.
        send({ type: "agent_start", agent: PLANNER_LABEL });
        const routerRaw = await invokeAgent(PLANNER_AGENT, lastUser.content);
        const decision = parseDecision(routerRaw);

        if (decision.mode === "pipeline") {
          const brief = decision.brief || lastUser.content;

          // 2) Researcher gathers structured findings (buffered).
          send({
            type: "agent_handoff",
            from: PLANNER_LABEL,
            to: RESEARCHER_LABEL,
            reason: "Gather supporting facts",
          });
          send({
            type: "tool_running",
            agent: RESEARCHER_LABEL,
            name: "research",
            call_id: "research",
          });
          const findings = await invokeAgent(
            RESEARCHER_AGENT,
            `User request:\n${lastUser.content}\n\nPlanner brief:\n${brief}`
          );
          send({ type: "tool_done", call_id: "research" });

          // 3) Writer composes the final answer (streamed to the client).
          send({
            type: "agent_handoff",
            from: RESEARCHER_LABEL,
            to: WRITER_LABEL,
            reason: "Compose the final answer",
          });
          await streamAgent(
            WRITER_AGENT,
            `User request:\n${lastUser.content}\n\nResearcher findings:\n${findings}`,
            (chunk) =>
              send({ type: "text_delta", agent: WRITER_LABEL, content: chunk })
          );
        } else {
          // Direct answer: the Planner already handled a simple request.
          const answer = (decision.answer ?? routerRaw).trim();
          const CHUNK = 24;
          for (let i = 0; i < answer.length; i += CHUNK) {
            send({
              type: "text_delta",
              agent: PLANNER_LABEL,
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
