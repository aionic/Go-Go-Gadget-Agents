# Orchestration — multi-agent / multi-step workflows

The environment supports self-hosted agents coordinating via **Service Bus** (async messaging),
**Dapr** (pub/sub + state building blocks), and **Cosmos DB** (durable thread/state), with
**Application Insights** tracing across the whole flow.

```mermaid
flowchart LR
  Trigger["Trigger / User request"] --> Orchestrator["Orchestrator Agent"]

  Orchestrator -->|enqueue tasks| SBQ["Service Bus<br/>queue: agent-tasks"]
  SBQ --> WorkerA["Worker Agent A"]
  SBQ --> WorkerB["Worker Agent B"]

  WorkerA -->|call tools / LLM| Foundry["gpt-5.4-mini"]
  WorkerB -->|knowledge| KA["Foundry IQ<br/>knowledge agent"]

  WorkerA -->|publish result| SBT["Service Bus<br/>topic: agent-events"]
  WorkerB -->|publish result| SBT
  SBT --> Orchestrator

  Orchestrator -->|persist thread / state| Cosmos[("Cosmos DB")]
  WorkerA -.->|Dapr pub/sub + state| Dapr["Dapr (CAE)"]
  WorkerB -.-> Dapr

  Orchestrator -->|traces| AI["Application Insights"]
  WorkerA -->|traces| AI
  WorkerB -->|traces| AI
```

## Patterns enabled

| Pattern | Backing service |
|---------|-----------------|
| Fan-out / fan-in task distribution | Service Bus queue (`agent-tasks`) |
| Event-driven coordination / choreography | Service Bus topic (`agent-events`) |
| Durable conversation threads & memory | Cosmos DB (`agentstate/threads`) |
| Sidecar pub/sub, state, bindings | Dapr on the Container Apps Environment |
| Reasoning + tool calls | Foundry `gpt-5.4-mini` |
| Grounded knowledge | Foundry IQ knowledge agent over AI Search |
| End-to-end tracing | Application Insights → Log Analytics |

## Self-hosted vs. hosted

Agents run as **self-hosted** containers on Azure Container Apps (not the managed agent
service), giving full control over the runtime, dependencies, and orchestration logic. Images
are pulled from ACR via the shared managed identity (`AcrPull`).
