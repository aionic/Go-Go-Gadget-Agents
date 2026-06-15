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
// Display name of the primary/orchestrator agent (multi-agent flow UI).
const AGENT_NAME = process.env.FOUNDRY_AGENT_NAME || "Agent";
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

        // Reuse the existing thread (Cosmos-backed by Foundry) or create one.
        let threadId = body.thread_id ?? "";
        if (!threadId) {
          const thread = await agents.threads.create();
          threadId = thread.id;
        }

        send({ type: "start", thread_id: threadId });
        // Primary/orchestrator agent begins the workflow.
        send({ type: "agent_start", agent: AGENT_NAME });

        await agents.messages.create(threadId, "user", lastUser.content);

        const streamEvents = await agents.runs
          .create(threadId, AGENT_ID)
          .stream();

        for await (const event of streamEvents as AsyncIterable<{
          event: string;
          data: unknown;
        }>) {
          switch (event.event) {
            case "thread.message.delta": {
              const delta = event.data as {
                delta?: {
                  content?: Array<{ type: string; text?: { value?: string } }>;
                };
              };
              const text = (delta.delta?.content ?? [])
                .filter((c) => c.type === "text")
                .map((c) => c.text?.value ?? "")
                .join("");
              if (text) send({ type: "text_delta", content: text });
              break;
            }
            case "thread.run.step.created": {
              const step = event.data as {
                id?: string;
                type?: string;
                step_details?: {
                  tool_calls?: Array<{
                    id?: string;
                    type?: string;
                    name?: string;
                    connected_agent?: { name?: string };
                  }>;
                };
              };
              for (const call of step.step_details?.tool_calls ?? []) {
                const connectedAgent = connectedAgentName(call);
                if (connectedAgent) {
                  // A connected/sub-agent picked up the work — render a handoff.
                  send({
                    type: "agent_handoff",
                    from: AGENT_NAME,
                    to: connectedAgent,
                    reason: "Delegated sub-task",
                  });
                } else {
                  send({
                    type: "tool_running",
                    name: call.type ?? "tool",
                    call_id: call.id ?? step.id,
                  });
                }
              }
              break;
            }
            case "thread.run.step.completed": {
              const step = event.data as {
                id?: string;
                step_details?: {
                  tool_calls?: Array<{
                    id?: string;
                    type?: string;
                    name?: string;
                    connected_agent?: { name?: string };
                  }>;
                };
              };
              for (const call of step.step_details?.tool_calls ?? []) {
                const connectedAgent = connectedAgentName(call);
                if (connectedAgent) {
                  // Sub-agent finished — control returns to the orchestrator.
                  send({
                    type: "agent_handoff",
                    from: connectedAgent,
                    to: AGENT_NAME,
                    reason: "Returned result",
                  });
                } else {
                  send({
                    type: "tool_done",
                    call_id: call.id ?? step.id,
                  });
                }
              }
              break;
            }
            case "thread.run.failed": {
              const run = event.data as { last_error?: { message?: string } };
              send({
                type: "error",
                message: run.last_error?.message ?? "Agent run failed",
              });
              break;
            }
            case "error": {
              const err = event.data as { message?: string };
              send({ type: "error", message: err.message ?? "Stream error" });
              break;
            }
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

// Detect a Foundry connected/sub-agent tool call and return its display name.
function connectedAgentName(call: {
  type?: string;
  name?: string;
  connected_agent?: { name?: string };
}): string | undefined {
  if (call.connected_agent?.name) return call.connected_agent.name;
  if (call.type === "connected_agent") return call.name ?? "Sub-agent";
  return undefined;
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
