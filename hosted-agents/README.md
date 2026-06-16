# Hosted Agents (v2)

Three [Microsoft Agent Framework](https://github.com/microsoft/agent-framework)
agents hosted on Microsoft Foundry using the **Responses protocol**. These are
the "microVM" / hosted-container agents that the UI invokes for the
Planner → Researcher → Writer pipeline.

Each agent runs as its own container (`ResponsesHostServer` on port `8088`) and
is registered with Foundry as `kind: hosted`.

| Agent        | Folder         | Role                                                        |
| ------------ | -------------- | ----------------------------------------------------------- |
| `ggga-planner`    | `planner/`     | Router — returns JSON `{mode:"direct"|"pipeline", ...}`.     |
| `ggga-researcher` | `researcher/`  | Produces structured findings from the planner's brief.      |
| `ggga-writer`     | `writer/`      | Composes the final prose answer from the findings.          |

The UI route orchestrates the handoffs client-side (Planner → optional
Researcher → Writer), matching the existing pipeline semantics.

## Why hosted (and why `azd`)

Hosted-agent registration is a control-plane action in the
`Microsoft.MachineLearningServices/workspaces/agents/*` namespace. The Azure MCP
`foundry` tools run as the MCP server's own first-party identity, which has **no
service principal in this tenant** and therefore 403s on agent writes. The clean
fix is to deploy with **your own credential** via `azd`, which uses
`azd auth login` (your Owner identity).

## Deploy (per agent)

Prerequisites (once):

```pwsh
azd ext install azure.ai.agents
azd auth login
```

Each agent folder is self-contained. From `hosted-agents/<agent>/`:

```pwsh
# Configure the azd env to point at the existing Foundry project + model.
azd env set FOUNDRY_PROJECT_ENDPOINT "https://aif-ggga-1w2vrg.services.ai.azure.com/api/projects/ggga-agents"
azd env set AZURE_AI_MODEL_DEPLOYMENT_NAME "gpt-5.4-mini"

# Run + smoke-test locally (host on http://localhost:8088).
azd ai agent run
azd ai agent invoke --local "Hi"

# Deploy to Foundry (builds container, pushes, registers hosted agent).
azd deploy

# Invoke the deployed agent.
azd ai agent invoke "Hi"
```

## RBAC

After deployment, the per-agent identity and the project-level agent identity
need **`Azure AI User`** at the Cognitive Services **account** scope
(`/subscriptions/05322c41-8e40-4575-9bc7-4509758926fb/resourceGroups/rg-ggga-1w2vrg/providers/Microsoft.CognitiveServices/accounts/aif-ggga-1w2vrg`).
The UI managed identity (`id-ggga-1w2vrg`) needs `Azure AI User` /
`Azure AI Developer` for runtime invocation (tracked in `infra/terraform/rbac.tf`).

## Local-only convention

- `.env` (gitignored) holds local secrets/config; copy from `.env.example`.
- Container listens on port `8088`; image base `python:3.12-slim`, `linux/amd64`.
