# Design decisions & rationale

The *why* behind the architecture. For *what* is deployed, see [architecture.md](architecture.md);
for *how to run it*, see [deployment.md](deployment.md).

## Hosted Foundry agents, not self-hosted orchestration

An earlier design ran self-hosted agents on the Container Apps Environment with **Service Bus +
Dapr** fan-out. We pivoted to **Foundry hosted agents** and removed that machinery.

| | Self-hosted (old) | Foundry hosted (current) |
|---|---|---|
| Where agents run | Your CAE containers | Foundry managed agent service (sandboxed micro-VMs) |
| Versioning | Your image tags + rollout | Immutable agent *versions* (data-plane objects) |
| Orchestration glue | Service Bus queue/topic + Dapr | None — the UI orchestrates the hand-offs |
| Infra surface | More (bus, subscriptions, Dapr) | Less |

**Why:** the hosted service gives immutable, independently-deployable agent versions, removes the
message-bus/Dapr infrastructure, and lets the team own the agent *code* without owning the agent
*runtime*. The Service Bus / Dapr resources were deleted.

## The Responses protocol, with UI-side orchestration

The hosted agents speak the **OpenAI Responses protocol** (`ResponsesHostServer`, `kind: hosted`).
The UI's `/api/chat` route invokes them server-side and **orchestrates the pipeline itself**:

1. **Planner** runs as a *router* and returns `{ "mode": "direct" | "pipeline", ... }`.
2. For a pipeline, the UI invokes the **Researcher** (buffered) then streams the **Writer**.
3. The UI emits `agent_handoff` / `text_delta` SSE events so the front end can animate the flow.

**Why UI-side orchestration** (instead of Foundry connected-agent run steps): it keeps each agent
simple and stateless (`store: false`), makes the hand-off logic explicit and testable, and lets
the UI render an accurate, real-time pipeline visualization. The token scope for invocation is
`https://ai.azure.com/.default`.

## Terraform owns infra; `azd` owns agent versions

The agent **version** (image + cpu/mem + env + protocols) is a Foundry **data-plane** object
created via the agents API — there is no ARM/Terraform resource for it. So:

- **Terraform** owns the account/project, model deployments, ACR, networking, data services, and
  **all static RBAC**.
- **`azd deploy`** owns the imperative agent-version create (idempotent; no-op if unchanged).

This split keeps infra declarative while letting agents ship independently.

## Networking: custom VNet + Cosmos private endpoint

The Container Apps Environment is **workload-profiles with a custom VNet**, and Cosmos DB is
reached through a **private endpoint** + linked private DNS zone.

**Why:** Cosmos public network access is **force-disabled by Azure Policy** in the target
subscriptions, so a private path is mandatory. The UI still reaches public endpoints (Foundry,
ACR) over the internet (`internal = false`). Key Vault and Postgres private endpoints are the
natural next step (see [best-practices.md](best-practices.md)).

## Secrets: native Container App secret, not Key Vault (yet)

The Entra **client secret** is stored as a **native Container App secret** — encrypted at rest by
the platform and surfaced to the container via `secretRef`, never as a plaintext env value.

**Why not Key Vault:** the project Key Vault has **public network access disabled** by policy with
no private endpoint, so Terraform (from the deployer) can't write a KV secret and the app can't
read one. Once a KV private endpoint is added to the CAE VNet, the secret can move to Key Vault.
The only *generated* secret (the Postgres admin password) does live in Key Vault.

## RBAC: two roles for agent invocation

Invoking a hosted agent over the Responses protocol triggers an authorization check for
`Microsoft.MachineLearningServices/workspaces/agents/action`. The UI managed identity therefore
holds **two** roles at the Foundry **account** scope:

- **Azure AI User** (`53ca6127-…`) — Cognitive Services data plane.
- **Azure AI Developer** (`64702f94-…`) — grants `Microsoft.MachineLearningServices/workspaces/*/action`
  (including `agents/action`); the least-privilege built-in role that does so.

Azure AI User **alone** returns 403 on invocation because it has no MachineLearningServices
permissions. Both are referenced by **stable GUID** (display names differ per tenant). See
[rbac.md](rbac.md) for the full matrix.

## Module strategy: AVM + AzAPI shim

- **AVM `avm/res/*`** for standard resources (RG, identity, Log Analytics, App Insights, Key Vault,
  Storage, Cosmos, Postgres, Search, Cognitive Services, ACR, Container Apps).
- **AzAPI** for the newer **Foundry project** (`Microsoft.CognitiveServices/accounts/projects`),
  which has no mature AVM module yet.
- Native **`azurerm`** for the VNet, subnets, Cosmos private endpoint, and private DNS.

**Why:** AVM gives well-tested, policy-aligned defaults; AzAPI fills the gap for preview resource
types without blocking on module availability.

## One resource group, one shared identity

Everything lives in a **single resource group** with a **single shared User-Assigned Managed
Identity** used by the UI. This keeps the demo's lifecycle atomic (one-command teardown) and the
identity story simple. Per-agent runtime identities are created by `azd` at deploy time and are
out of Terraform's scope by design.

---

↩ Back to the [documentation hub](README.md) · Related: [architecture.md](architecture.md) · [rbac.md](rbac.md) · [best-practices.md](best-practices.md)
