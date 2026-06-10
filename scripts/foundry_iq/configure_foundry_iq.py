"""Configure Azure AI Search for hybrid + agentic retrieval (Foundry IQ).

Creates, idempotently:
  1. A search index with text + vector fields, an AzureOpenAI vectorizer (integrated
     vectorization) and a semantic configuration (enables hybrid: keyword + vector + semantic).
  2. A blob data source over the RAG-source container (managed-identity connection).
  3. A skillset (text split + AzureOpenAI embedding skill; optional Document Intelligence).
  4. An indexer that ingests + vectorizes the blobs.
  5. A Foundry IQ knowledge agent (agentic retrieval) over the index, via preview REST.

Auth uses DefaultAzureCredential (the deploying user / managed identity). RBAC is wired by
Terraform (Search Index Data Contributor, Search Service Contributor, etc.).

Run via:  uv run configure_foundry_iq.py

Environment variables (set by Terraform local-exec):
  SEARCH_ENDPOINT, FOUNDRY_ENDPOINT, EMBEDDING_DEPLOYMENT, EMBEDDING_DIMENSIONS,
  LLM_DEPLOYMENT, STORAGE_RESOURCE_ID, STORAGE_CONTAINER, INDEX_NAME,
  KNOWLEDGE_AGENT_NAME, SEARCH_API_VERSION
"""

from __future__ import annotations

import os
import sys

from azure.core.exceptions import HttpResponseError
from azure.identity import DefaultAzureCredential
from azure.search.documents.indexes import SearchIndexClient, SearchIndexerClient
from azure.search.documents.indexes.models import (
    AzureOpenAIEmbeddingSkill,
    AzureOpenAIVectorizer,
    AzureOpenAIVectorizerParameters,
    HnswAlgorithmConfiguration,
    KnowledgeAgent,
    KnowledgeAgentAzureOpenAIModel,
    KnowledgeAgentTargetIndex,
    IndexingParameters,
    IndexingParametersConfiguration,
    InputFieldMappingEntry,
    OutputFieldMappingEntry,
    SearchableField,
    SearchField,
    SearchFieldDataType,
    SearchIndex,
    SearchIndexer,
    SearchIndexerDataContainer,
    SearchIndexerDataSourceConnection,
    SearchIndexerSkillset,
    SemanticConfiguration,
    SemanticField,
    SemanticPrioritizedFields,
    SemanticSearch,
    SimpleField,
    SplitSkill,
    VectorSearch,
    VectorSearchProfile,
)

SEARCH_ENDPOINT = os.environ["SEARCH_ENDPOINT"]
FOUNDRY_ENDPOINT = os.environ["FOUNDRY_ENDPOINT"]
EMBEDDING_DEPLOYMENT = os.environ.get("EMBEDDING_DEPLOYMENT", "text-embedding-3-large")
EMBEDDING_DIMENSIONS = int(os.environ.get("EMBEDDING_DIMENSIONS", "3072"))
LLM_DEPLOYMENT = os.environ.get("LLM_DEPLOYMENT", "gpt-5.4-mini")
STORAGE_RESOURCE_ID = os.environ["STORAGE_RESOURCE_ID"]
STORAGE_CONTAINER = os.environ.get("STORAGE_CONTAINER", "rag-source")
INDEX_NAME = os.environ.get("INDEX_NAME", "rag-index")
KNOWLEDGE_AGENT_NAME = os.environ.get("KNOWLEDGE_AGENT_NAME", "agents-knowledge")

DATA_SOURCE_NAME = f"{INDEX_NAME}-blob"
SKILLSET_NAME = f"{INDEX_NAME}-skillset"
INDEXER_NAME = f"{INDEX_NAME}-indexer"
VECTORIZER_NAME = "foundry-openai-vectorizer"

credential = DefaultAzureCredential()


def build_index() -> SearchIndex:
    fields = [
        SimpleField(name="id", type=SearchFieldDataType.String, key=True),
        SearchableField(name="content", type=SearchFieldDataType.String),
        SimpleField(name="title", type=SearchFieldDataType.String, filterable=True, sortable=True),
        SimpleField(name="source", type=SearchFieldDataType.String, filterable=True),
        SearchField(
            name="content_vector",
            type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
            searchable=True,
            vector_search_dimensions=EMBEDDING_DIMENSIONS,
            vector_search_profile_name="hnsw-profile",
        ),
    ]

    vector_search = VectorSearch(
        algorithms=[HnswAlgorithmConfiguration(name="hnsw-config")],
        profiles=[
            VectorSearchProfile(
                name="hnsw-profile",
                algorithm_configuration_name="hnsw-config",
                vectorizer_name=VECTORIZER_NAME,
            )
        ],
        vectorizers=[
            AzureOpenAIVectorizer(
                vectorizer_name=VECTORIZER_NAME,
                parameters=AzureOpenAIVectorizerParameters(
                    resource_url=FOUNDRY_ENDPOINT,
                    deployment_name=EMBEDDING_DEPLOYMENT,
                    model_name=EMBEDDING_DEPLOYMENT,
                ),
            )
        ],
    )

    semantic_search = SemanticSearch(
        default_configuration_name="default-semantic",
        configurations=[
            SemanticConfiguration(
                name="default-semantic",
                prioritized_fields=SemanticPrioritizedFields(
                    title_field=SemanticField(field_name="title"),
                    content_fields=[SemanticField(field_name="content")],
                ),
            )
        ],
    )

    return SearchIndex(
        name=INDEX_NAME,
        fields=fields,
        vector_search=vector_search,
        semantic_search=semantic_search,
    )


def upsert_index() -> None:
    client = SearchIndexClient(SEARCH_ENDPOINT, credential)
    client.create_or_update_index(build_index())
    print(f"Index '{INDEX_NAME}' created/updated (hybrid: keyword + vector + semantic).")


def upsert_data_source(client: SearchIndexerClient) -> None:
    # Managed-identity connection to blob storage (no keys).
    ds = SearchIndexerDataSourceConnection(
        name=DATA_SOURCE_NAME,
        type="azureblob",
        connection_string=f"ResourceId={STORAGE_RESOURCE_ID};",
        container=SearchIndexerDataContainer(name=STORAGE_CONTAINER),
    )
    client.create_or_update_data_source_connection(ds)
    print(f"Data source '{DATA_SOURCE_NAME}' created/updated.")


def upsert_skillset(client: SearchIndexerClient) -> None:
    split_skill = SplitSkill(
        text_split_mode="pages",
        maximum_page_length=2000,
        page_overlap_length=200,
        inputs=[InputFieldMappingEntry(name="text", source="/document/content")],
        outputs=[OutputFieldMappingEntry(name="textItems", target_name="pages")],
    )
    embedding_skill = AzureOpenAIEmbeddingSkill(
        resource_url=FOUNDRY_ENDPOINT,
        deployment_name=EMBEDDING_DEPLOYMENT,
        model_name=EMBEDDING_DEPLOYMENT,
        dimensions=EMBEDDING_DIMENSIONS,
        context="/document/pages/*",
        inputs=[InputFieldMappingEntry(name="text", source="/document/pages/*")],
        outputs=[OutputFieldMappingEntry(name="embedding", target_name="content_vector")],
    )
    skillset = SearchIndexerSkillset(
        name=SKILLSET_NAME,
        skills=[split_skill, embedding_skill],
        description="Chunk + vectorize RAG source documents.",
    )
    client.create_or_update_skillset(skillset)
    print(f"Skillset '{SKILLSET_NAME}' created/updated.")


def upsert_indexer(client: SearchIndexerClient) -> None:
    indexer = SearchIndexer(
        name=INDEXER_NAME,
        data_source_name=DATA_SOURCE_NAME,
        target_index_name=INDEX_NAME,
        skillset_name=SKILLSET_NAME,
        parameters=IndexingParameters(
            configuration=IndexingParametersConfiguration(
                parsing_mode="default",
                query_timeout=None,
            )
        ),
    )
    client.create_or_update_indexer(indexer)
    print(f"Indexer '{INDEXER_NAME}' created/updated (run scheduled on demand).")


def upsert_knowledge_agent() -> None:
    """Create the Foundry IQ knowledge agent (agentic retrieval) via the typed SDK.

    Uses SearchIndexClient.create_or_update_agent so the SDK pins a compatible
    preview api-version. Knowledge agents are a preview surface and may evolve.
    """
    client = SearchIndexClient(SEARCH_ENDPOINT, credential)
    agent = KnowledgeAgent(
        name=KNOWLEDGE_AGENT_NAME,
        target_indexes=[
            KnowledgeAgentTargetIndex(
                index_name=INDEX_NAME,
                default_reranker_threshold=2.5,
            )
        ],
        models=[
            KnowledgeAgentAzureOpenAIModel(
                azure_open_ai_parameters=AzureOpenAIVectorizerParameters(
                    resource_url=FOUNDRY_ENDPOINT,
                    deployment_name=LLM_DEPLOYMENT,
                    model_name=LLM_DEPLOYMENT,
                )
            )
        ],
    )
    client.create_or_update_agent(agent)
    print(f"Knowledge agent '{KNOWLEDGE_AGENT_NAME}' created/updated (agentic retrieval).")


def main() -> int:
    try:
        upsert_index()
        indexer_client = SearchIndexerClient(SEARCH_ENDPOINT, credential)
        upsert_data_source(indexer_client)
        upsert_skillset(indexer_client)
        upsert_indexer(indexer_client)
        upsert_knowledge_agent()
    except HttpResponseError as exc:
        print(f"ERROR (search): {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print("Foundry IQ configuration complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
