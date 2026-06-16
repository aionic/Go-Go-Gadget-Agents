# Go-Go-Gadget-Agents — End-to-End Agent Demo Infrastructure

![Terraform](https://img.shields.io/badge/Terraform-%E2%89%A5%201.10-7B42BC?logo=terraform&logoColor=white)
![azurerm](https://img.shields.io/badge/provider-azurerm%204.x-844FBA?logo=terraform&logoColor=white)
![AzAPI](https://img.shields.io/badge/provider-azapi%202.x-844FBA?logo=terraform&logoColor=white)
![Azure Verified Modules](https://img.shields.io/badge/Azure-Verified%20Modules-0078D4?logo=microsoftazure&logoColor=white)
![Azure AI Foundry](https://img.shields.io/badge/Azure%20AI-Foundry-0078D4?logo=microsoftazure&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![uv](https://img.shields.io/badge/packaging-uv-DE5FE9?logo=astral&logoColor=white)
![validate](https://img.shields.io/badge/terraform%20validate-passing-success)
![deployment](https://img.shields.io/badge/Azure%20deploy-validated-success?logo=microsoftazure&logoColor=white)
![status](https://img.shields.io/badge/status-hackathon%20demo-blueviolet)
![License](https://img.shields.io/badge/license-MIT-green)

Terraform (Azure Verified Modules + AzAPI) that stands up a complete environment for a
**multi-agent** workflow: a Next.js **Agent UI** on Azure Container Apps that invokes three
**Foundry hosted agents** (`ggga-planner` → `ggga-researcher` → `ggga-writer`) over the
Responses protocol, backed by a Foundry IQ RAG stack. This repo is the **infrastructure layer**;
the UI (`agent-ui/`) and agents (`hosted-agents/`) are deployed on top of it.

```mermaid
flowchart TB
  User["User (browser)"]
  subgraph RG["Resource Group (single)"]
    subgraph OBS["Observability"]
      LA["Log Analytics"]
      AI["Application Insights"]
    end
    UAMI["User-Assigned<br/>Managed Identity"]
    KV["Key Vault"]
    subgraph NET["Networking (VNet)"]
      CAESN["snet-cae-infra"]
      PESN["snet-pe + private DNS"]
    end
    subgraph FRONT["Front end (Container Apps)"]
      CAE["Container Apps Env<br/>(workload profiles, VNet)"]
      UI["Agent UI<br/>Next.js · Entra sign-in · SSE"]
      ACR["Container Registry"]
    end
    subgraph AGENTS["Foundry hosted agents"]
      PLAN["ggga-planner (router)"]
      RES["ggga-researcher"]
      WRIT["ggga-writer"]
    end
    subgraph AICORE["AI / RAG"]
      FOUNDRY["AI Foundry (AIServices)<br/>gpt-5.4-mini · embed-3-large · project"]
      SEARCH["Azure AI Search<br/>hybrid + agentic retrieval"]
      DI["Document Intelligence"]
    end
    subgraph DATA["Data"]
      PG["PostgreSQL Flexible<br/>(pgvector)"]
      ST["Storage<br/>(rag-source)"]
      COSMOS["Cosmos DB<br/>(threads + feedback)"]
    end
  end

  User -->|HTTPS + Entra sign-in| UI
  UI -->|pull image| ACR
  UI -->|invoke agents (Responses)| FOUNDRY
  UI -->|thread state / feedback| COSMOS
  UI -->|secrets| KV
  UI -->|traces| AI
  UI -->|hosted on| CAE
  CAE -->|VNet egress| CAESN
  COSMOS -. private endpoint .- PESN
  FOUNDRY --> PLAN
  PLAN --> RES --> WRIT
  ACR -->|image pull (project MI)| FOUNDRY
  RES -->|grounded retrieval| SEARCH
  SEARCH -->|integrated vectorization| FOUNDRY
  SEARCH -->|indexer reads blobs| ST
  SEARCH -.->|enrich| DI
  FOUNDRY -->|agentic queries| SEARCH
  AI --> LA
  UAMI -.->|passwordless auth| UI
```

## Documentation

| Doc | Contents |
|-----|----------|
| [docs/README.md](docs/README.md) | Documentation index |
| [docs/architecture.md](docs/architecture.md) | System architecture (Mermaid) + module strategy |
| [docs/data-flow.md](docs/data-flow.md) | RAG ingestion & agentic retrieval (sequence diagrams) |
| [docs/orchestration.md](docs/orchestration.md) | Multi-agent / multi-step orchestration flow |
| [docs/rbac.md](docs/rbac.md) | Passwordless identity & RBAC matrix |
| [docs/deployment.md](docs/deployment.md) | Deployment & post-provision workflow |

## What gets deployed

| Layer | Resources |
|-------|-----------|
| **Foundation** | Resource Group, shared User-Assigned Managed Identity, Log Analytics, Application Insights, Key Vault |
| **Data** | PostgreSQL Flexible Server (Entra + password, pgvector), Storage Account (`rag-source` container), Cosmos DB (agent thread/state) |
| **AI** | Azure AI Foundry (AIServices) account + project, `gpt-5.4-mini` (LLM) + `text-embedding-3-large` (embeddings), Azure AI Search (hybrid), Document Intelligence |
| **Front end** | Next.js **Agent UI** Container App (Entra sign-in + SSE chat proxy) on a VNet-integrated, workload-profiles Container Apps Environment |
| **Agents** | Three **Foundry hosted agents** (`ggga-planner` → `ggga-researcher` → `ggga-writer`) on the Foundry managed agent service (deployed with `azd`) |
| **Compute** | Azure Container Registry (UI + agent images) |
| **Networking** | Custom VNet (CAE infrastructure subnet) + Cosmos DB private endpoint & private DNS zone |
| **RAG / Foundry IQ** | AI Search index + integrated vectorization + indexer over Storage, knowledge agent (agentic retrieval) configured post-deploy |

All service-to-service auth is **passwordless** (Entra ID + the shared managed identity).
The only generated secret (Postgres admin password) is stored in Key Vault.

## Prerequisites

- **Terraform >= 1.10** (the AVM storage submodules require it). Install: `winget install Hashicorp.Terraform`.
- **Azure CLI**, logged in: `az login` (the deployer's identity is granted data-plane admin roles).
- **uv** (for the post-provision Python scripts): https://docs.astral.sh/uv/
- A subscription with quota for the requested Foundry models in `foundry_location`.

## Deploy

```powershell
cd infra/terraform
Copy-Item terraform.tfvars.example terraform.tfvars   # edit as needed

terraform init
terraform validate
terraform plan -out tfplan
terraform apply tfplan
```

Post-provision steps run automatically via `local-exec`:
1. **Postgres seed** (`scripts/seed_postgres`, `uv run seed.py`) — builds the schema and seeds sample data.
2. **Foundry IQ config** (`scripts/foundry_iq`, `uv run configure_foundry_iq.py`) — creates the
   Search index, integrated vectorizer, skillset, indexer, and knowledge agent.

> If running from CI / a service principal, set `entra_admin_principal_type = "ServicePrincipal"`.

### Deploy the app (UI + hosted agents)

Terraform provisions the platform; the application is deployed on top of it:

```powershell
# 1. Build & push the UI image, then set agent_ui_image in tfvars and re-apply
az acr build --registry <acr-name> --image agent-ui:<tag> ./agent-ui

# 2. Deploy each Foundry hosted agent (imperative; agent version is a Foundry data-plane object)
cd hosted-agents/planner    ; azd deploy
cd ../researcher            ; azd deploy
cd ../writer                ; azd deploy
```

The UI signs users in with Entra ID; register an Entra app with a **web** redirect URI matching
the `agent_ui_redirect_uri` output and supply `azure_ad_client_id` / `azure_ad_client_secret` in
`terraform.tfvars`. The client secret is stored as a **native Container App secret** (encrypted,
surfaced via `secretRef`) — see [docs/deployment.md](docs/deployment.md).

## Key variables

| Variable | Default | Notes |
|----------|---------|-------|
| `environment_name` | `ggga` | Drives resource names |
| `location` | `westus3` | Primary region |
| `foundry_location` | `eastus2` | Region for Foundry + models (model availability) |
| `enable_pgvector` | `true` | pgvector extension on Postgres |
| `run_postgres_seed` | `true` | Run schema + seed post-provision |
| `enable_app_insights` / `enable_cosmos_db` / `enable_document_intelligence` | `true` | Add-on toggles |
| `agent_ui_image` | placeholder | UI container image (`<acr>.azurecr.io/agent-ui:<tag>`) |
| `azure_ad_client_id` / `azure_ad_client_secret` | `""` | Entra app for UI sign-in (secret stored as a native Container App secret) |
| `allowed_ip_address` | `""` (auto-detect) | Firewall allow-list IP |
| `principal_id` | `""` (auto-detect) | Deployer object ID for data-plane roles |
| `restrict_public_ip` | `true` | Restrict AI Search to the deployer IP; set `false` for RBAC-only (corpnet / policy-governed subs) |

## Outputs

Endpoints, names, and connection info needed by the UI and agents (Foundry project endpoint,
Search, Postgres, Cosmos, ACR, Key Vault, App Insights, UI app URL + Entra redirect URI) are
exposed as Terraform outputs.

## Teardown

```powershell
terraform destroy
```

## Notes & caveats

- **Model availability** in `westus3` is the main risk — `gpt-5.4-mini` / `text-embedding-3-large`
  may only be in select regions, hence the separate `foundry_location` (default `eastus2`).
  Verify the model version per region with `az cognitiveservices model list`.
- **Foundry IQ knowledge agent** is created with the typed `azure-search-documents` SDK
  (`SearchIndexClient.create_or_update_agent`), which pins a compatible preview API version.
- Networking is **VNet-integrated**: a custom VNet hosts the Container Apps Environment plus a
  **Cosmos DB private endpoint** (Cosmos public access is policy-disabled). The UI reaches
  Foundry / ACR over public endpoints.
- State is **local**. Switch to a remote `azurerm` backend for shared/team use.

### Deployment validated ✅

A full `terraform apply` was run end-to-end against an Azure (MCAPS) subscription: all ~58
resources deployed, both models + the Foundry project reached `Succeeded`, and the Foundry IQ
RAG/agentic pipeline (`rag-index` + `agents-knowledge` agent) was created via `local-exec`.
See [docs/deployment.md](docs/deployment.md) for the full validation report, the bugs found &
fixed, and the **policy-governed-subscription** constraints (public-network-access disabled on
Key Vault/Postgres, Cognitive local-auth disabled, Cosmos `listKeys` deny assignment, corpnet
egress variance) with the recommended private-networking approach for customer environments.

See the [documentation index](docs/README.md) for architecture, data-flow, RBAC, and deployment diagrams.

## License

Released under the [MIT License](LICENSE).
