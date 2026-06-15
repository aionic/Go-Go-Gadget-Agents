"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useAuth } from "@/components/auth-provider";
import { useConfig } from "@/components/config-provider";
import { useAgentChat } from "@/lib/use-agent-chat";
import { AgentFlow, type FlowPart } from "@/components/agent-flow";

export default function Home() {
  const { messages, sendMessage, submitFeedback, status, error, activeAgent, newConversation } = useAgentChat();
  const [input, setInput] = useState("");
  const isLoading = status === "submitted" || status === "streaming";
  const { userName, userEmail } = useAuth();
  const { gitCommit, buildDate } = useConfig();
  // Feedback UI state — which message currently has the 👎 reason box open,
  // and the in-progress text. Cleared on submit/cancel.
  const [feedbackOpenFor, setFeedbackOpenFor] = useState<string | null>(null);
  const [feedbackReason, setFeedbackReason] = useState("");

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input });
    setInput("");
  }

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Sticky-bottom auto-scroll: only follow new content when the user is
  // already pinned near the bottom. If they've scrolled up (e.g. to read an
  // expanded tool-call panel), we leave their viewport alone so streaming
  // text doesn't yank them back down.
  const stickToBottomRef = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      // 80px tolerance — small bounce / sub-pixel rounding still counts as
      // "at the bottom".
      const atBottom = distanceFromBottom < 80;
      stickToBottomRef.current = atBottom;
      setShowJumpToBottom(!atBottom);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const jumpToBottom = () => {
    stickToBottomRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-zinc-800 px-6 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-bold">
          G
        </div>
        <div>
          <h1 className="text-sm font-semibold text-zinc-100">Go-Go-Gadget Agents</h1>
          <p className="text-xs text-zinc-400">
            Azure AI Foundry
            {(buildDate || (gitCommit && gitCommit !== "unknown")) && (
              <span className="ml-2 text-zinc-600">
                · build{" "}
                {buildDate ? buildDate.slice(0, 10) : ""}
                {buildDate && gitCommit && gitCommit !== "unknown" ? "-" : ""}
                {gitCommit && gitCommit !== "unknown" ? gitCommit : ""}
              </span>
            )}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={newConversation}
            className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200"
            title="Start a new conversation (clears thread)"
          >
            New conversation
          </button>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-xs text-zinc-400">Connected</span>
          </div>
          <span className="text-xs text-zinc-500">
            {userName || userEmail}
          </span>
          <a
            href="/api/auth/logout"
            className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200"
          >
            Sign out
          </a>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-600/20">
                <svg
                  className="h-8 w-8 text-blue-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                  />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-zinc-200">
                Go-Go-Gadget Agents
              </h2>
              <p className="mt-1 max-w-sm text-sm text-zinc-400">
                Ask anything. The agent can reason over your data, run tools, and
                retrieve from your knowledge base via Azure AI Foundry.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {[
                  "What can you help me with?",
                  "Search the knowledge base",
                  "Summarize the latest documents",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-800"
                    onClick={() => setInput(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {message.role === "assistant" && (
                <div className="mr-3 mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold">
                  G
                </div>
              )}
              <div
                className={`max-w-[75%] space-y-2 ${message.role === "user" ? "items-end" : "items-start"}`}
              >
                {(() => {
                  // Split parts: render the response text in ONE card, with
                  // tool-call cards grouped below it (instead of interleaved).
                  const parts = message.parts ?? [];
                  const textParts = parts.filter((p) => p.type === "text") as {
                    type: "text";
                    text: string;
                  }[];
                  const toolParts = parts.filter(
                    (p) => p.type.startsWith("tool-") || p.type === "dynamic-tool"
                  );
                  const combinedText = textParts.map((p) => p.text).join("");
                  // Multi-agent flow: any handoff marker switches this message
                  // to the agent-attributed flow renderer.
                  const isMultiAgent =
                    message.role === "assistant" &&
                    parts.some((p) => p.type === "handoff");

                  return (
                    <>
                      {isMultiAgent ? (
                        <AgentFlow
                          parts={parts as unknown as FlowPart[]}
                          activeAgent={
                            isLoading &&
                            message.id === messages[messages.length - 1]?.id
                              ? activeAgent
                              : null
                          }
                        />
                      ) : (
                        combinedText && (
                        <div
                          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${message.role === "user"
                              ? "rounded-br-sm bg-blue-600 text-white"
                              : "rounded-bl-sm bg-zinc-800 text-zinc-100"
                            }`}
                        >
                          {message.role === "assistant" ? (
                            <div className="overflow-x-auto prose prose-sm prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-table:my-2 prose-th:px-3 prose-th:py-1.5 prose-td:px-3 prose-td:py-1.5 prose-th:bg-zinc-700/50">
                              <ReactMarkdown>{combinedText}</ReactMarkdown>
                            </div>
                          ) : (
                            <p className="whitespace-pre-wrap">{combinedText}</p>
                          )}
                        </div>
                        )
                      )}

                      {!isMultiAgent && toolParts.length > 0 && (
                        <details className="rounded-lg border border-zinc-800 bg-zinc-900/40">
                          <summary className="cursor-pointer px-3 py-1.5 text-[11px] text-zinc-500 hover:text-zinc-300">
                            {toolParts.length} tool call{toolParts.length === 1 ? "" : "s"}
                            {" · "}
                            {toolParts.filter((p) => (p as { state: string }).state === "output-available").length}/{toolParts.length} done
                          </summary>
                          <div className="space-y-1.5 px-2 pb-2">
                            {toolParts.map((part, i) => {
                              const toolPart = part as {
                                type: string;
                                toolName?: string;
                                state: string;
                                input?: unknown;
                                output?: unknown;
                              };
                              const toolName =
                                toolPart.toolName ??
                                toolPart.type.replace(/^tool-/, "");
                              const isDone = toolPart.state === "output-available";
                              return (
                                <div
                                  key={i}
                                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs"
                                >
                                  <div className="flex items-center gap-2 text-zinc-400">
                                    <svg
                                      className="h-3.5 w-3.5 text-amber-400"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                                      />
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                      />
                                    </svg>
                                    <span className="font-medium text-amber-400">
                                      {toolName}
                                    </span>
                                    <span
                                      className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] ${isDone
                                          ? "bg-green-900/50 text-green-400"
                                          : "bg-zinc-700 text-zinc-400"
                                        }`}
                                    >
                                      {isDone ? "done" : "running…"}
                                    </span>
                                  </div>
                                  {(Boolean(toolPart.input) || Boolean(toolPart.output)) && (
                                    <details className="mt-1.5">
                                      <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
                                        {isDone ? "Show result" : "Show args"}
                                      </summary>
                                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all text-[10px] text-zinc-400">
                                        {JSON.stringify(
                                          isDone ? toolPart.output : toolPart.input,
                                          null,
                                          2
                                        )}
                                      </pre>
                                    </details>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </details>
                      )}

                      {/* Thumbs up/down — only for assistant replies that
                          have actual text and that aren't currently
                          streaming. Disabled once submitted. */}
                      {message.role === "assistant" &&
                        combinedText &&
                        !(isLoading && message.id === messages[messages.length - 1]?.id) && (
                          <div className="flex items-center gap-1.5 pt-0.5">
                            <button
                              type="button"
                              aria-label="Helpful"
                              disabled={!!message.feedback?.submitted}
                              onClick={() =>
                                submitFeedback({
                                  messageId: message.id,
                                  rating: "up",
                                })
                              }
                              className={`rounded-md p-1 text-xs transition ${
                                message.feedback?.rating === "up"
                                  ? "bg-green-900/40 text-green-400"
                                  : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                              } ${message.feedback?.submitted && message.feedback.rating !== "up" ? "opacity-30" : ""}`}
                            >
                              👍
                            </button>
                            <button
                              type="button"
                              aria-label="Not helpful"
                              disabled={!!message.feedback?.submitted}
                              onClick={() => {
                                if (feedbackOpenFor === message.id) {
                                  setFeedbackOpenFor(null);
                                  setFeedbackReason("");
                                } else {
                                  setFeedbackOpenFor(message.id);
                                  setFeedbackReason("");
                                }
                              }}
                              className={`rounded-md p-1 text-xs transition ${
                                message.feedback?.rating === "down"
                                  ? "bg-red-900/40 text-red-400"
                                  : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                              } ${message.feedback?.submitted && message.feedback.rating !== "down" ? "opacity-30" : ""}`}
                            >
                              👎
                            </button>
                            {message.feedback?.submitted && (
                              <span className="text-[10px] text-zinc-500">
                                Thanks for the feedback
                              </span>
                            )}
                          </div>
                        )}

                      {/* 👎 reason capture — kept lightweight so users
                          actually fill it in. Submit on Enter (Shift+Enter
                          for newline) or via the Send button. */}
                      {feedbackOpenFor === message.id &&
                        !message.feedback?.submitted && (
                          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
                            <textarea
                              autoFocus
                              value={feedbackReason}
                              onChange={(e) => setFeedbackReason(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault();
                                  submitFeedback({
                                    messageId: message.id,
                                    rating: "down",
                                    reason: feedbackReason.trim() || undefined,
                                  });
                                  setFeedbackOpenFor(null);
                                  setFeedbackReason("");
                                }
                              }}
                              placeholder="What went wrong? (optional, helps us improve)"
                              rows={2}
                              className="w-full resize-none rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
                            />
                            <div className="mt-1.5 flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setFeedbackOpenFor(null);
                                  setFeedbackReason("");
                                }}
                                className="rounded-md px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-300"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  submitFeedback({
                                    messageId: message.id,
                                    rating: "down",
                                    reason: feedbackReason.trim() || undefined,
                                  });
                                  setFeedbackOpenFor(null);
                                  setFeedbackReason("");
                                }}
                                className="rounded-md bg-red-700 px-2.5 py-1 text-[11px] text-white hover:bg-red-600"
                              >
                                Submit
                              </button>
                            </div>
                          </div>
                        )}
                    </>
                  );
                })()}
              </div>

              {message.role === "user" && (
                <div className="ml-3 mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-600 text-xs font-bold">
                  U
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="mr-3 mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold">
                G
              </div>
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-zinc-800 px-4 py-3">
                <div className="flex gap-1">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" />
                </div>
                {activeAgent && (
                  <span className="text-xs text-zinc-400">
                    {activeAgent} is working…
                  </span>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-400">
              <span className="font-medium">Error:</span> {error.message}
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="relative border-t border-zinc-800 px-4 py-4">
        {showJumpToBottom && (
          <button
            type="button"
            onClick={jumpToBottom}
            className="absolute -top-12 left-1/2 -translate-x-1/2 rounded-full border border-zinc-700 bg-zinc-800/90 px-3 py-1.5 text-xs text-zinc-200 shadow-lg backdrop-blur transition-colors hover:border-zinc-500 hover:bg-zinc-700"
            title="Jump to latest"
          >
            ↓ Jump to latest
          </button>
        )}
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex max-w-3xl items-end gap-3"
        >
          <textarea
            className="min-h-[44px] max-h-36 flex-1 resize-none rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            placeholder="Ask the agent anything…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg
              className="h-5 w-5 rotate-90"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          </button>
        </form>
        <p className="mt-2 text-center text-xs text-zinc-600">
          Press Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
