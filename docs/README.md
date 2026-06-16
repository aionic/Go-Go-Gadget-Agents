# Documentation

Architecture, design, and operational docs for Go-Go-Gadget-Agents. New here? Start at the
[root README](../README.md) for the About + Quickstart, then come back for the deep dives.

## Suggested reading path

1. **[architecture.md](architecture.md)** — the system at a glance: components, the request path, and the module strategy.
2. **[design.md](design.md)** — the *why* behind the architecture: hosted agents vs. self-hosted, the Responses protocol, networking, and secret handling.
3. **[orchestration.md](orchestration.md)** — how the Planner → Researcher → Writer pipeline runs over the Responses protocol.
4. **[data-flow.md](data-flow.md)** — how documents become a hybrid index and how agentic retrieval grounds answers.
5. **[rbac.md](rbac.md)** — the passwordless identity model and the full role matrix.
6. **[best-practices.md](best-practices.md)** — security, networking, and operational guidance (incl. policy-governed subscriptions).
7. **[deployment.md](deployment.md)** — the end-to-end deploy + post-provision workflow and the validated-deployment report.

## Map

| Doc | Read it when you want to… |
|-----|---------------------------|
| [architecture.md](architecture.md) | Understand what's deployed and how the pieces connect |
| [design.md](design.md) | Know *why* it's built this way (and the trade-offs) |
| [orchestration.md](orchestration.md) | Follow the multi-agent pipeline and the UI's role |
| [data-flow.md](data-flow.md) | See RAG ingestion + agentic retrieval step by step |
| [rbac.md](rbac.md) | Audit identities, roles, and least-privilege scopes |
| [best-practices.md](best-practices.md) | Harden, productionize, or run it in a governed sub |
| [deployment.md](deployment.md) | Deploy it, troubleshoot, or read the validation report |

> All diagrams use [Mermaid](https://mermaid.js.org/) and render natively on GitHub.

## Conventions

- **One resource group**, one shared **User-Assigned Managed Identity** (UAMI) for passwordless auth.
- **AVM `avm/res/*`** modules for standard resources; **AzAPI** for the Foundry project; native
  **`azurerm`** for the VNet / private endpoint; **`uv` Python** post-provision scripts.
- The Next.js **Agent UI** runs on a VNet-integrated Container Apps Environment; the three
  **Foundry hosted agents** run on the Foundry managed agent service (deployed with `azd`).
- Naming: `<abbr><env>-<token>` (CAF-aligned abbreviations in [`infra/terraform/locals.tf`](../infra/terraform/locals.tf)).

---

↩ Back to the [root README](../README.md) · App docs: [agent-ui](../agent-ui/README.md) · [hosted-agents](../hosted-agents/README.md)
