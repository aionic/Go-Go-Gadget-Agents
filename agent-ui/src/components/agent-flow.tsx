"use client";

import ReactMarkdown from "react-markdown";

// Minimal shape of the message parts produced by useAgentChat().
export interface FlowPart {
  type: string;
  text?: string;
  agent?: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  from?: string;
  to?: string;
  reason?: string;
}

// Deterministic per-agent accent colour from a small palette.
const PALETTE = [
  { dot: "bg-blue-500", text: "text-blue-300", ring: "border-blue-500/40", soft: "bg-blue-500/10" },
  { dot: "bg-emerald-500", text: "text-emerald-300", ring: "border-emerald-500/40", soft: "bg-emerald-500/10" },
  { dot: "bg-violet-500", text: "text-violet-300", ring: "border-violet-500/40", soft: "bg-violet-500/10" },
  { dot: "bg-amber-500", text: "text-amber-300", ring: "border-amber-500/40", soft: "bg-amber-500/10" },
  { dot: "bg-pink-500", text: "text-pink-300", ring: "border-pink-500/40", soft: "bg-pink-500/10" },
  { dot: "bg-cyan-500", text: "text-cyan-300", ring: "border-cyan-500/40", soft: "bg-cyan-500/10" },
];

export function agentColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/[\s-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

type Block =
  | { kind: "segment"; agent?: string; items: FlowPart[] }
  | { kind: "handoff"; from?: string; to: string; reason?: string };

function buildBlocks(parts: FlowPart[]): Block[] {
  const blocks: Block[] = [];
  let current: Extract<Block, { kind: "segment" }> | null = null;

  for (const p of parts) {
    if (p.type === "handoff") {
      blocks.push({ kind: "handoff", from: p.from, to: p.to ?? "Agent", reason: p.reason });
      current = { kind: "segment", agent: p.to, items: [] };
      blocks.push(current);
    } else {
      if (!current) {
        current = { kind: "segment", agent: p.agent, items: [] };
        blocks.push(current);
      }
      current.items.push(p);
    }
  }
  // Drop empty trailing segments (e.g. a handoff with no following content yet).
  return blocks.filter((b) => b.kind !== "segment" || b.items.length > 0);
}

function pipelineAgents(parts: FlowPart[]): string[] {
  const seq: string[] = [];
  for (const p of parts) {
    const name = p.type === "handoff" ? p.to : p.agent;
    if (name && seq[seq.length - 1] !== name) seq.push(name);
  }
  return seq;
}

function ToolCard({ part }: { part: FlowPart }) {
  const toolName = part.toolName ?? part.type.replace(/^tool-/, "");
  const isDone = part.state === "output-available";
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs">
      <div className="flex items-center gap-2 text-zinc-400">
        <svg className="h-3.5 w-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span className="font-medium text-amber-400">{toolName}</span>
        <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] ${isDone ? "bg-green-900/50 text-green-400" : "bg-zinc-700 text-zinc-400"}`}>
          {isDone ? "done" : "running…"}
        </span>
      </div>
      {(part.input || part.output) ? (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
            {isDone ? "Show result" : "Show args"}
          </summary>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all text-[10px] text-zinc-400">
            {JSON.stringify(isDone ? part.output : part.input, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function AgentBadge({ name, active = false }: { name: string; active?: boolean }) {
  const c = agentColor(name);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${c.ring} ${c.soft} ${c.text} ${active ? "ring-1 ring-offset-0" : ""}`}>
      <span className={`flex h-4 w-4 items-center justify-center rounded-full ${c.dot} text-[8px] font-bold text-white`}>
        {initials(name)}
      </span>
      {name}
      {active && <span className="ml-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
    </span>
  );
}

export function AgentFlow({
  parts,
  activeAgent,
}: {
  parts: FlowPart[];
  activeAgent?: string | null;
}) {
  const blocks = buildBlocks(parts);
  const pipeline = pipelineAgents(parts);

  return (
    <div className="space-y-2">
      {/* Pipeline strip — the process at a glance */}
      {pipeline.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
          <span className="mr-1 text-[10px] uppercase tracking-wide text-zinc-500">Flow</span>
          {pipeline.map((name, i) => (
            <div key={`${name}-${i}`} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-zinc-600">→</span>}
              <AgentBadge name={name} active={activeAgent === name} />
            </div>
          ))}
        </div>
      )}

      {/* Ordered blocks: agent segments + handoff connectors */}
      {blocks.map((block, i) => {
        if (block.kind === "handoff") {
          return (
            <div key={`h-${i}`} className="flex items-center gap-2 py-1 pl-1 text-[11px] text-zinc-500">
              <span className="h-px flex-1 bg-zinc-800" />
              <span className="flex items-center gap-1.5">
                {block.from && <AgentBadge name={block.from} />}
                <span className="text-zinc-600">handoff →</span>
                <AgentBadge name={block.to} active={activeAgent === block.to} />
              </span>
              {block.reason && <span className="italic text-zinc-600">· {block.reason}</span>}
              <span className="h-px flex-1 bg-zinc-800" />
            </div>
          );
        }

        const text = block.items.filter((p) => p.type === "text").map((p) => p.text ?? "").join("");
        const tools = block.items.filter((p) => p.type.startsWith("tool-") || p.type === "dynamic-tool");
        const c = block.agent ? agentColor(block.agent) : null;

        return (
          <div key={`s-${i}`} className={`rounded-xl border ${c ? c.ring : "border-zinc-800"} ${c ? c.soft : "bg-zinc-900/30"} p-2.5`}>
            {block.agent && (
              <div className="mb-1.5">
                <AgentBadge name={block.agent} active={activeAgent === block.agent} />
              </div>
            )}
            {text && (
              <div className="rounded-lg bg-zinc-800/80 px-3 py-2 text-sm leading-relaxed text-zinc-100">
                <div className="overflow-x-auto prose prose-sm prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-table:my-2 prose-th:px-3 prose-th:py-1.5 prose-td:px-3 prose-td:py-1.5 prose-th:bg-zinc-700/50">
                  <ReactMarkdown>{text}</ReactMarkdown>
                </div>
              </div>
            )}
            {tools.length > 0 && (
              <div className="mt-1.5 space-y-1.5">
                {tools.map((t, j) => (
                  <ToolCard key={j} part={t} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
