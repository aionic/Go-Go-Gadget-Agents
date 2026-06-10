# Architecture

## System overview

```mermaid
flowchart TB
  subgraph RG["Resource Group (single lifecycle)"]
    direction TB

    subgraph OBS["Observability"]
      LA["Log Analytics"]
      AI["Application Insights"]
    end

    UAMI["User-Assigned<br/>Managed Identity<br/>(shared, passwordless)"]
    KV["Key Vault<br/>(PG password, conn strings)"]

    subgraph AICORE["AI / RAG"]
      FOUNDRY["Azure AI Foundry (AIServices)<br/>• gpt-5.4-mini (LLM)<br/>• text-embedding-3-large<br/>• Foundry project"]
      SEARCH["Azure AI Search<br/>hybrid + agentic retrieval"]
      DI["Document Intelligence"]
    end

    subgraph DATA["Data"]
      PG["PostgreSQL Flexible<br/>Entra + password · pgvector"]
      ST["Storage Account<br/>container: rag-source"]
      COSMOS["Cosmos DB<br/>agent thread / state"]
    end

    subgraph ORCH["Orchestration & Compute"]
      SB["Service Bus<br/>queue + topic"]
      ACR["Container Registry"]
      CAE["Container Apps Env<br/>(Dapr enabled)"]
      CA["Agent Container App<br/>(self-hosted)"]
    end
  end

  CA -->|pull image| ACR
  CA -->|LLM / embeddings| FOUNDRY
  CA -->|knowledge / retrieval| SEARCH
  CA -->|thread state| COSMOS
  CA -->|messages| SB
  CA -->|secrets| KV
  CA -->|traces / OTel| AI
  CA -->|SQL + vectors| PG
  CA -->|hosted on| CAE

  SEARCH -->|integrated vectorization| FOUNDRY
  SEARCH -->|indexer reads blobs| ST
  SEARCH -.->|parse complex docs| DI
  FOUNDRY -->|agentic queries| SEARCH

  AI --> LA
  UAMI -.->|identity| CA
```

## Component responsibilities

| Component | Role |
|-----------|------|
| **User-Assigned Managed Identity** | Single shared identity; all service-to-service auth is passwordless (Entra ID). |
| **Log Analytics + Application Insights** | Central logs + distributed tracing/OpenTelemetry for agents. |
| **Key Vault** | Stores the only generated secret (Postgres admin password) + connection strings. |
| **Azure AI Foundry** | LLM (`gpt-5.4-mini`) and embeddings (`text-embedding-3-large`) endpoints + agent project. |
| **Azure AI Search** | Hybrid index (keyword + vector + semantic) and Foundry IQ agentic retrieval. |
| **Document Intelligence** | Parses complex documents prior to Search ingestion. |
| **Storage (rag-source)** | Source documents for RAG enrichment; read by the Search indexer. |
| **PostgreSQL Flexible** | Relational sample dataset; `pgvector` for in-DB vector demos. |
| **Cosmos DB** | Durable agent thread/state/memory store. |
| **Service Bus** | Async messaging backbone for multi-step / multi-agent orchestration. |
| **Container Apps Env + App** | Self-hosted agent runtime, Dapr-enabled. |
| **Container Registry** | Hosts agent container images. |

## Module strategy

```mermaid
flowchart LR
  TF["Terraform root<br/>infra/terraform"] --> AVM["AVM avm/res/* modules<br/>(standard resources)"]
  TF --> AZAPI["AzAPI shim<br/>Foundry project<br/>accounts/projects@2025-06-01"]
  TF --> SCRIPTS["uv Python post-provision<br/>(local-exec)"]
  SCRIPTS --> SEED["seed_postgres<br/>schema + sample data"]
  SCRIPTS --> FIQ["foundry_iq<br/>index · vectorizer · indexer · knowledge agent"]
```

- **AVM `avm/res/*`** for: resource group, managed identity, Log Analytics, App Insights, Key
  Vault, Storage, Cosmos, PostgreSQL, Service Bus, AI Search, Cognitive Services (Foundry +
  Document Intelligence), Container Registry, Container Apps Environment + App.
- **AzAPI** for the newer **Foundry project** (`Microsoft.CognitiveServices/accounts/projects@2025-06-01`).
- **Post-deploy `uv` scripts** for data-plane surfaces that aren't control-plane resources.

See [data-flow.md](data-flow.md), [orchestration.md](orchestration.md), [rbac.md](rbac.md),
and [deployment.md](deployment.md) for the detailed flows.
