# =====================================================================
# Cross-service passwordless RBAC wiring
# =====================================================================

locals {
  search_identity_principal_id = try(module.search.resource.identity[0].principal_id, null)
}

# --- Agents (UAMI) need to call the Foundry LLM/embeddings endpoint ---
resource "azurerm_role_assignment" "uami_foundry_openai_user" {
  scope                            = module.foundry.resource_id
  role_definition_name             = local.role_openai_user
  principal_id                     = module.uami.principal_id
  skip_service_principal_aad_check = true
}

# --- AI Search -> Foundry (integrated vectorization via embeddings) ---
resource "azurerm_role_assignment" "search_foundry_openai_user" {
  scope                            = module.foundry.resource_id
  role_definition_name             = local.role_openai_user
  principal_id                     = local.search_identity_principal_id
  skip_service_principal_aad_check = true
}

# --- AI Search -> Storage (indexer reads the RAG source container) ---
resource "azurerm_role_assignment" "search_storage_blob_reader" {
  scope                            = module.storage.resource_id
  role_definition_name             = local.role_blob_data_reader
  principal_id                     = local.search_identity_principal_id
  skip_service_principal_aad_check = true
}

# --- Foundry -> AI Search (agentic retrieval / knowledge agent queries) ---
resource "azurerm_role_assignment" "foundry_search_index_reader" {
  scope                            = module.search.resource_id
  role_definition_name             = local.role_search_index_data_rdr
  principal_id                     = module.foundry.system_assigned_mi_principal_id
  skip_service_principal_aad_check = true
}

# --- Cosmos DB data-plane: agents (UAMI) + deployer read/write thread state ---
resource "azurerm_cosmosdb_sql_role_assignment" "uami_cosmos_data_contributor" {
  count               = var.enable_cosmos_db ? 1 : 0
  resource_group_name = module.resource_group.name
  account_name        = module.cosmos[0].name
  role_definition_id  = "${module.cosmos[0].resource_id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002"
  principal_id        = module.uami.principal_id
  scope               = module.cosmos[0].resource_id
}

resource "azurerm_cosmosdb_sql_role_assignment" "deployer_cosmos_data_contributor" {
  count               = var.enable_cosmos_db ? 1 : 0
  resource_group_name = module.resource_group.name
  account_name        = module.cosmos[0].name
  role_definition_id  = "${module.cosmos[0].resource_id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002"
  principal_id        = local.principal_id
  scope               = module.cosmos[0].resource_id
}
