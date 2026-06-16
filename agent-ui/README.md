# Agent UI

Next.js 16 chat interface for the Go-Go-Gadget Agents workspace. Provides Entra ID
sign-in and real-time SSE streaming of agent responses and tool invocations from the
three Azure AI Foundry **hosted agents** (`ggga-planner` → `ggga-researcher` → `ggga-writer`).

> Adapted from the AdTech MCP agent UI — same style, structure, and deployment shape,
> retargeted at a Foundry agent (server-side proxy) with identity-only Entra sign-in.

## Features

- **Entra ID sign-in** — OAuth 2.0 authorization-code + PKCE (identity-only: `openid profile email`)
- **Foundry agent proxy** — `/api/chat` streams from a Foundry agent server-side using the
  Container App's managed identity, so no resource credential reaches the browser
- **Multi-agent flow visualization** — agent pipeline strip, per-agent attributed segments,
  and handoff connectors (with reasons) rendered from the stream in real time
- **SSE streaming** — real-time `agent_start` / `agent_handoff` / `text_delta` / `tool_running` /
  `tool_done` events via the `useAgentChat()` hook
- **Dark theme** — Tailwind CSS 4, zinc-950, markdown rendering, collapsible tool-call panels,
  sticky-bottom auto-scroll, mode chips (Auto/Short/Long), thumbs up/down feedback (→ Cosmos)

## Multi-agent / handoffs

The chat stream carries agent attribution so the UI can show *what the process looks like*:

| Event | Meaning |
|-------|---------|
| `agent_start` `{ agent }` | The workflow's first/orchestrator agent began |
| `agent_handoff` `{ from, to, reason? }` | Control transferred to another agent |
| `text_delta` / `tool_running` `{ agent? }` | Output attributed to the active agent |

[components/agent-flow.tsx](src/components/agent-flow.tsx) renders a colored pipeline
(`Planner → Researcher → Writer`), per-agent segment cards, and handoff dividers. The live
"working…" indicator names the active agent.

The proxy ([api/chat](src/app/api/chat/route.ts)) orchestrates the pipeline itself over the
Foundry **Responses protocol**: the Planner runs as a router (`{mode:"direct"|"pipeline"}`), and
for a pipeline it invokes the Researcher (buffered) then streams the Writer, emitting the
`agent_handoff` events as it goes. To preview the UX without a live backend, set
`DEMO_MULTI_AGENT=true` — the route streams a scripted Planner → Researcher → Writer sequence.

## Routes

| Route | Description |
|-------|-------------|
| `/` | Chat interface (auth-guarded) |
| `/api/chat` | Server-side Foundry agent proxy (SSE) |
| `/api/feedback` | Thumbs up/down sink (logs; wire to Cosmos to persist) |
| `/api/auth/*` | Entra sign-in (login, callback, logout, me) |
| `/api/config` | Runtime config for the client |
| `/api/health` | Health check (status + git commit) |

## Environment variables

| Var | Purpose |
|-----|---------|
| `AZURE_AD_CLIENT_ID` / `AZURE_AD_TENANT_ID` | Entra app for sign-in |
| `AZURE_AD_CLIENT_SECRET` | Confidential-client token exchange (optional for PKCE) |
| `REDIRECT_URI` | App's https FQDN (must match an Entra web redirect URI) |
| `FOUNDRY_PROJECT_ENDPOINT` | Foundry project endpoint (hosted-agent Responses protocol) |
| `PLANNER_AGENT_NAME` / `RESEARCHER_AGENT_NAME` / `WRITER_AGENT_NAME` | Hosted-agent names (optional; default to `ggga-*`) |
| `DEMO_MULTI_AGENT` | `true` to stream a scripted multi-agent handoff demo |
| `COSMOS_ENDPOINT` / `COSMOS_DATABASE` / `COSMOS_FEEDBACK_CONTAINER` | Feedback persistence (passwordless) |
| `AZURE_CLIENT_ID` | Selects the user-assigned managed identity for `DefaultAzureCredential` |

## Running locally

```bash
npm install
npm run dev    # → http://localhost:3000
```

Locally, `DefaultAzureCredential` falls back to your `az login` identity, so the signed-in
Azure user must be able to **invoke the hosted agents** — i.e. hold **Azure AI User** *and*
**Azure AI Developer** at the Foundry account scope (the latter grants the
`Microsoft.MachineLearningServices/workspaces/agents/action` the Responses endpoint checks).
Set the env vars in `.env.local`.

## Build & deploy

The Terraform stack ([infra/terraform/agent_ui.tf](../infra/terraform/agent_ui.tf)) provisions a
Container App with all env vars wired (UAMI, ACR pull, Foundry endpoint, redirect URI). It uses a
placeholder image until you push the real one:

```powershell
# from repo root, after `terraform apply` has created the ACR
$acr = terraform -chdir=infra/terraform output -raw acr_login_server
az acr build --registry $acr.Split('.')[0] --image agent-ui:latest ./agent-ui

# then set the image + Entra app and re-apply
terraform -chdir=infra/terraform apply `
  -var "agent_ui_image=$acr/agent-ui:latest" `
  -var "azure_ad_client_id=<entra-app-client-id>"
```

Register the value of the `agent_ui_redirect_uri` Terraform output as a **web** redirect URI on
the Entra app. (The hosted agents themselves are deployed separately with `azd` — see
[../hosted-agents/README.md](../hosted-agents/README.md).)
