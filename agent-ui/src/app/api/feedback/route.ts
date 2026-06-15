import { NextRequest, NextResponse } from "next/server";
import { CosmosClient, type Container } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";
import { getSession } from "@/lib/auth-session";

export const runtime = "nodejs";

const COSMOS_ENDPOINT = process.env.COSMOS_ENDPOINT ?? "";
const COSMOS_DATABASE = process.env.COSMOS_DATABASE ?? "agentstate";
const COSMOS_FEEDBACK_CONTAINER =
  process.env.COSMOS_FEEDBACK_CONTAINER ?? "feedback";

// Lazily construct the Cosmos container (passwordless via managed identity).
let _container: Container | null = null;
function getContainer(): Container | null {
  if (!COSMOS_ENDPOINT) return null;
  if (!_container) {
    const client = new CosmosClient({
      endpoint: COSMOS_ENDPOINT,
      aadCredentials: new DefaultAzureCredential(),
    });
    _container = client
      .database(COSMOS_DATABASE)
      .container(COSMOS_FEEDBACK_CONTAINER);
  }
  return _container;
}

interface FeedbackBody {
  thread_id?: string;
  message_id?: string;
  rating?: "up" | "down";
  reason?: string | null;
  mode?: string | null;
  prompt?: string | null;
  response?: string | null;
  tool_calls?: string[];
  agents?: string[];
}

/**
 * Persist thumbs up/down feedback to Cosmos DB (passwordless). Best-effort:
 * if Cosmos isn't configured, the feedback is logged and a 200 is returned so
 * the chat experience never stalls on feedback.
 */
export async function POST(request: NextRequest) {
  const sessionId = request.cookies.get("session_id")?.value;
  const session = sessionId ? getSession(sessionId) : undefined;
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: FeedbackBody;
  try {
    body = (await request.json()) as FeedbackBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const item = {
    id: `${body.thread_id || "no-thread"}:${body.message_id || crypto.randomUUID()}`,
    threadId: body.thread_id || "no-thread",
    messageId: body.message_id ?? null,
    userId: session.userOid ?? null,
    userEmail: session.userEmail ?? null,
    rating: body.rating ?? null,
    reason: body.reason ?? null,
    mode: body.mode ?? null,
    prompt: body.prompt ?? null,
    response: body.response ?? null,
    toolCalls: body.tool_calls ?? [],
    agents: body.agents ?? [],
    createdAt: new Date().toISOString(),
  };

  const container = getContainer();
  if (!container) {
    console.log("[FEEDBACK] (no Cosmos configured)", JSON.stringify(item));
    return NextResponse.json({ ok: true, persisted: false });
  }

  try {
    await container.items.upsert(item);
    return NextResponse.json({ ok: true, persisted: true });
  } catch (err) {
    // Non-fatal — log and return ok so the UI doesn't surface a failure.
    console.warn("[FEEDBACK] Cosmos upsert failed (non-fatal):", err);
    return NextResponse.json({ ok: true, persisted: false });
  }
}
