"use client";

import { useCallback, useState } from "react";

interface TextPart {
  type: "text";
  text: string;
  // Name of the agent that produced this text segment (multi-agent flows).
  agent?: string;
}

interface ToolPart {
  type: string; // "tool-{name}"
  toolName: string;
  state: "input-streaming" | "output-available";
  callId?: string;
  input?: unknown;
  output?: unknown;
  // Agent that invoked the tool.
  agent?: string;
}

// Marks a control transfer between agents in a multi-agent workflow. `from`
// is undefined for the initial agent (workflow start).
interface HandoffPart {
  type: "handoff";
  from?: string;
  to: string;
  reason?: string;
}

type MessagePart = TextPart | ToolPart | HandoffPart;

export interface UIMessage {
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  // Local-only — tracks whether the user submitted thumbs up/down on
  // an assistant reply. Persisted server-side via POST /api/feedback;
  // the UI uses this to disable the buttons after submission.
  feedback?: { rating: "up" | "down"; submitted: boolean };
}

type ChatStatus = "idle" | "submitted" | "streaming" | "ready";

const THREAD_STORAGE_KEY = "ggga.threadId";

export function useAgentChat() {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  // Name of the agent currently working (multi-agent flows). Cleared when the
  // turn finishes. Used by the UI to label the live "working…" indicator.
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  // threadId is hydrated from localStorage so refreshes resume the same
  // Foundry-backed agent thread. Mode persists user preference.
  const [threadId, setThreadId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(THREAD_STORAGE_KEY);
  });
  const newConversation = useCallback(() => {
    setMessages([]);
    setError(null);
    setStatus("idle");
    setThreadId(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(THREAD_STORAGE_KEY);
    }
  }, []);

  const sendMessage = useCallback(
    async ({ text }: { text: string }) => {
      if (!text.trim() || status === "submitted" || status === "streaming")
        return;

      setError(null);

      const userMsg: UIMessage = {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text }],
      };

      const assistantId = crypto.randomUUID();

      // Capture messages snapshot before state update for the API call
      const snapshotMessages = messages;

      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: assistantId, role: "assistant", parts: [] },
      ]);
      setStatus("submitted");

      try {
        // Build messages list for the agent (full history for context)
        const apiMessages = [...snapshotMessages, userMsg]
          .map((m) => ({
            role: m.role,
            content: m.parts
              .filter((p): p is TextPart => p.type === "text")
              .map((p) => p.text)
              .join(""),
          }))
          .filter((m) => m.content.trim());

        // Same-origin call — gated by the Entra session cookie. The server
        // route proxies to Foundry using the managed identity.
        const response = await fetch(`/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: apiMessages,
            thread_id: threadId,
          }),
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Agent error ${response.status}: ${body}`);
        }

        setStatus("streaming");

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let done = false;

        const updateAssistant = (
          updater: (parts: MessagePart[]) => MessagePart[]
        ) => {
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === assistantId);
            if (idx === -1) return prev;
            const updated = [...prev];
            updated[idx] = {
              ...updated[idx],
              parts: updater(updated[idx].parts),
            };
            return updated;
          });
        };

        // Tracks the agent currently producing output, so text/tool parts can
        // be attributed and the UI can render the handoff flow.
        let currentAgent: string | undefined;

        while (!done) {
          const { done: streamDone, value } = await reader.read();
          if (streamDone) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();

            if (data === "[DONE]") {
              // Mark any still-running tools as done
              updateAssistant((parts) =>
                parts.map((p) =>
                  (p.type.startsWith("tool-") || p.type === "dynamic-tool") &&
                  (p as ToolPart).state !== "output-available"
                    ? { ...p, state: "output-available" as const }
                    : p
                )
              );
              setActiveAgent(null);
              done = true;
              break;
            }

            let event: Record<string, unknown>;
            try {
              event = JSON.parse(data);
            } catch {
              continue;
            }

            if (
              event.type === "start" &&
              typeof event.thread_id === "string"
            ) {
              const tid = event.thread_id as string;
              setThreadId((prev) => {
                if (prev === tid) return prev;
                if (typeof window !== "undefined") {
                  window.localStorage.setItem(THREAD_STORAGE_KEY, tid);
                }
                return tid;
              });
            } else if (
              event.type === "agent_start" &&
              typeof event.agent === "string"
            ) {
              // Initial agent of the workflow. Record a handoff marker with no
              // `from` so the UI can show the entry point.
              currentAgent = event.agent;
              setActiveAgent(event.agent);
              const to = event.agent;
              updateAssistant((parts) => [...parts, { type: "handoff", to }]);
            } else if (
              event.type === "agent_handoff" &&
              typeof event.to === "string"
            ) {
              // Control transferred to another agent.
              const from =
                typeof event.from === "string" ? event.from : currentAgent;
              const to = event.to as string;
              const reason =
                typeof event.reason === "string" ? event.reason : undefined;
              currentAgent = to;
              setActiveAgent(to);
              updateAssistant((parts) => [
                ...parts,
                { type: "handoff", from, to, reason },
              ]);
            } else if (
              event.type === "text_delta" &&
              typeof event.content === "string"
            ) {
              const content = event.content;
              // Allow per-event attribution to override the tracked agent.
              const agent =
                typeof event.agent === "string" ? event.agent : currentAgent;
              updateAssistant((parts) => {
                // Append to the last text part only when it belongs to the same
                // agent; otherwise start a new (agent-attributed) text segment.
                const last = parts[parts.length - 1];
                if (
                  last &&
                  last.type === "text" &&
                  (last as TextPart).agent === agent
                ) {
                  return parts.map((p, i) =>
                    i === parts.length - 1
                      ? { ...p, text: (p as TextPart).text + content }
                      : p
                  );
                }
                return [...parts, { type: "text", text: content, agent }];
              });
            } else if (
              event.type === "tool_running" &&
              typeof event.name === "string"
            ) {
              const toolName = event.name;
              const agent =
                typeof event.agent === "string" ? event.agent : currentAgent;
              const callId =
                typeof event.call_id === "string" ? event.call_id : undefined;
              updateAssistant((parts) => [
                ...parts,
                {
                  type: `tool-${toolName}`,
                  toolName,
                  callId,
                  agent,
                  state: "input-streaming" as const,
                  input: {},
                },
              ]);
            } else if (event.type === "tool_done") {
              const callId =
                typeof event.call_id === "string" ? event.call_id : undefined;
              const preview =
                typeof event.preview === "string" ? event.preview : undefined;
              updateAssistant((parts) =>
                parts.map((p) => {
                  if (p.type !== "text" && p.type.startsWith("tool-")) {
                    const tp = p as ToolPart;
                    // Match by call_id if provided, else mark the most recent
                    // still-running tool part as done.
                    const matches =
                      callId !== undefined
                        ? tp.callId === callId
                        : tp.state === "input-streaming";
                    if (matches) {
                      return {
                        ...tp,
                        state: "output-available" as const,
                        output: preview ?? tp.output,
                      };
                    }
                  }
                  return p;
                })
              );
            } else if (event.type === "error") {
              throw new Error(String(event.message ?? "Unknown agent error"));
            }
          }
        }

        // Remove empty assistant placeholder if no text was streamed
        setMessages((prev) =>
          prev.filter(
            (m) =>
              !(m.id === assistantId && !m.parts.some((p) => p.type === "text"))
          )
        );
        setStatus("ready");
        setActiveAgent(null);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        setStatus("ready");
        setActiveAgent(null);
        // Remove the empty assistant placeholder on error
        setMessages((prev) =>
          prev.filter((m) => !(m.id === assistantId && m.parts.length === 0))
        );
      }
    },
    [messages, status, threadId]
  );

  // Submit thumbs up/down on an assistant message. Best-effort: failures
  // are surfaced via console only — feedback is non-critical and the chat
  // experience must not stall on a 500 from /api/feedback.
  const submitFeedback = useCallback(
    async ({
      messageId,
      rating,
      reason,
    }: {
      messageId: string;
      rating: "up" | "down";
      reason?: string;
    }) => {
      // Locate the assistant message and the prior user prompt to give
      // the eval pipeline self-contained context.
      const idx = messages.findIndex((m) => m.id === messageId);
      if (idx < 0) return;
      const assistant = messages[idx];
      if (assistant.role !== "assistant") return;
      const priorUser = [...messages.slice(0, idx)]
        .reverse()
        .find((m) => m.role === "user");

      const promptText = (priorUser?.parts ?? [])
        .filter((p): p is TextPart => p.type === "text")
        .map((p) => p.text)
        .join("");
      const responseText = assistant.parts
        .filter((p): p is TextPart => p.type === "text")
        .map((p) => p.text)
        .join("");
      const toolCalls = assistant.parts
        .filter(
          (p): p is ToolPart =>
            p.type.startsWith("tool-") || p.type === "dynamic-tool"
        )
        .map((p) => p.toolName ?? p.type.replace(/^tool-/, ""));

      // Agents involved in producing this reply (order preserved, de-duped).
      const agents = Array.from(
        new Set(
          assistant.parts
            .map((p) =>
              p.type === "handoff"
                ? (p as HandoffPart).to
                : (p as TextPart | ToolPart).agent
            )
            .filter((a): a is string => typeof a === "string")
        )
      );

      // Mark optimistically — re-clicking is disabled in the UI anyway,
      // and the server is best-effort.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, feedback: { rating, submitted: true } }
            : m
        )
      );

      try {
        await fetch(`/api/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            thread_id: threadId ?? "",
            message_id: messageId,
            rating,
            reason: reason ?? null,
            prompt: promptText || null,
            response: responseText || null,
            tool_calls: toolCalls,
            agents,
          }),
        });
      } catch (err) {
        console.warn("submitFeedback failed (non-fatal):", err);
      }
    },
    [messages, threadId]
  );

  return {
    messages,
    sendMessage,
    submitFeedback,
    status,
    error,
    threadId,
    activeAgent,
    newConversation,
  };
}
