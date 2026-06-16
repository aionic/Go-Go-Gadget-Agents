# Documentation

Architecture and operational docs for the Go-Go-Gadget-Agents infrastructure.

| Doc | Contents |
|-----|----------|
| [architecture.md](architecture.md) | System architecture diagram, component map, module strategy |
| [data-flow.md](data-flow.md) | RAG ingestion + Foundry IQ agentic-retrieval sequence diagrams |
| [orchestration.md](orchestration.md) | Foundry hosted-agent pipeline (planner → researcher → writer) over the Responses protocol |
| [rbac.md](rbac.md) | Passwordless identity model + full RBAC matrix |
| [deployment.md](deployment.md) | Deploy + post-provision workflow, UI / hosted-agent deploy, prerequisites, teardown |

> All diagrams use [Mermaid](https://mermaid.js.org/) and render natively on GitHub.

## Conventions

- **One resource group**, one shared **User-Assigned Managed Identity** (UAMI) for passwordless auth.
- **AVM `avm/res/*`** Terraform modules for standard resources; **AzAPI** shim for the newer
  Foundry project; native **`azurerm`** for the VNet / private endpoint; **`uv` Python**
  post-provision scripts for data-plane configuration.
- The Next.js **Agent UI** runs on a VNet-integrated Container Apps Environment; the three
  **Foundry hosted agents** run on the Foundry managed agent service (deployed with `azd`).
- Naming: `<abbr><env>-<token>` (CAF-aligned abbreviations in `infra/terraform/locals.tf`).
