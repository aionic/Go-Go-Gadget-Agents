# Data Flow — RAG ingestion & agentic retrieval

## 1. Ingestion + integrated vectorization

How documents in the `rag-source` container become a hybrid-searchable index.

```mermaid
sequenceDiagram
  autonumber
  participant Blob as Storage (rag-source)
  participant Indexer as AI Search Indexer
  participant DI as Document Intelligence
  participant Skill as Embedding Skill
  participant Emb as Foundry Embeddings
  participant Index as Search Index (hybrid)

  Blob->>Indexer: new / updated documents (MI auth)
  opt complex documents
    Indexer->>DI: extract layout / tables / figures
    DI-->>Indexer: structured text
  end
  Indexer->>Indexer: split into chunks (pages)
  Indexer->>Skill: chunk text
  Skill->>Emb: embed(text-embedding-3-large)
  Emb-->>Skill: vectors
  Skill-->>Indexer: content_vector
  Indexer->>Index: upsert text + vector + metadata
```

## 2. Agentic retrieval (Foundry IQ)

How an agent answers a complex question with grounded, cited results.

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant UI as Agent UI (Container App)
  participant Agent as Foundry hosted agent (ggga-researcher)
  participant KA as Foundry IQ Knowledge Agent
  participant LLM as gpt-5.4-mini
  participant Index as Search Index (hybrid)

  User->>UI: question
  UI->>Agent: invoke (Responses protocol)
  Agent->>KA: retrieve(question, chat history)
  KA->>LLM: decompose into subqueries
  LLM-->>KA: subqueries
  par parallel hybrid queries
    KA->>Index: subquery 1 (keyword + vector)
    KA->>Index: subquery 2 (keyword + vector)
  end
  Index-->>KA: candidate passages
  KA->>KA: semantic rerank + merge
  KA-->>Agent: grounded passages + citations
  Agent->>LLM: synthesize answer (with context)
  LLM-->>Agent: answer
  Agent-->>UI: cited answer (streamed)
  UI-->>User: cited answer (SSE)
```

## Why hybrid + agentic

- **Hybrid** = keyword (BM25) + **vector** similarity + **semantic** reranker, so both exact
  terms and meaning are matched.
- **Agentic retrieval** decomposes complex/multi-part questions, runs subqueries in parallel,
  reranks, and returns traceable, cited evidence — improving relevance over single-shot RAG.

Configured by `scripts/foundry_iq/configure_foundry_iq.py` (index, vectorizer, skillset,
indexer, and knowledge agent). The embedding deployment and dimensions are parameterized.
