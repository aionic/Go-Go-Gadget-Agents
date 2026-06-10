# =====================================================================
# Post-provision: configure Foundry IQ agentic retrieval (Python via uv)
# =====================================================================

resource "null_resource" "foundry_iq_config" {
  triggers = {
    search      = local.search_endpoint
    index       = "rag-index"
    script_hash = filemd5("${path.module}/../../scripts/foundry_iq/configure_foundry_iq.py")
  }

  provisioner "local-exec" {
    working_dir = "${path.module}/../../scripts/foundry_iq"
    interpreter = ["pwsh", "-Command"]
    command     = "uv run configure_foundry_iq.py"

    environment = {
      SEARCH_ENDPOINT      = local.search_endpoint
      FOUNDRY_ENDPOINT     = module.foundry.endpoint
      EMBEDDING_DEPLOYMENT = var.embedding_deployment.name
      EMBEDDING_DIMENSIONS = "3072"
      LLM_DEPLOYMENT       = var.llm_deployment.name
      STORAGE_RESOURCE_ID  = module.storage.resource_id
      STORAGE_CONTAINER    = "rag-source"
      INDEX_NAME           = "rag-index"
      KNOWLEDGE_AGENT_NAME = "agents-knowledge"
    }
  }

  depends_on = [
    module.search,
    module.foundry,
    module.storage,
    azurerm_role_assignment.search_foundry_openai_user,
    azurerm_role_assignment.search_storage_blob_reader,
    azurerm_role_assignment.foundry_search_index_reader,
  ]
}
