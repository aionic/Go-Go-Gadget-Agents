# =====================================================================
# Cross-service passwordless RBAC wiring
# =====================================================================

locals {
  search_identity_principal_id = try(module.search.resource.identity[0].principal_id, null)
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

# =====================================================================
# Hosted Foundry agents (managed agent service)
# =====================================================================
# The hosted agents (ggga-planner / ggga-researcher / ggga-writer) run on the
# managed Foundry agent service, NOT on the Container Apps Environment. Their
# per-agent runtime identities are created by `azd` at deploy time and azd
# auto-assigns each the "Foundry User" (Azure AI User) role at account scope,
# so those assignments are intentionally NOT declared here.

# --- UI (shared UAMI) invokes the Foundry hosted agents (data plane) ---
# The UI's /api/chat proxies to the hosted agents over the Responses protocol
# using the shared UAMI. That requires "Azure AI User" (surfaced as "Foundry
# User" in some tenants) at the Cognitive Services ACCOUNT scope. Referenced by
# the stable built-in role GUID 53ca6127-... so the assignment is immune to the
# display-name difference between tenants.
resource "azurerm_role_assignment" "uami_foundry_ai_user" {
  scope                            = module.foundry.resource_id
  role_definition_id               = "/subscriptions/${data.azurerm_client_config.current.subscription_id}/providers/Microsoft.Authorization/roleDefinitions/53ca6127-db72-4b80-b1b0-d745d6d5456d"
  principal_id                     = module.uami.principal_id
  skip_service_principal_aad_check = true
}

# --- UI (shared UAMI) invokes the Foundry hosted agents (agent action) ---
# Invoking a hosted agent over the Responses protocol triggers an authz check
# for "Microsoft.MachineLearningServices/workspaces/agents/action". The "Azure
# AI User" role above only grants Microsoft.CognitiveServices/* and therefore
# does NOT satisfy that check (the UI got a 403 on agent invocation). The
# built-in "Azure AI Developer" role (GUID 64702f94-...) grants
# Microsoft.MachineLearningServices/workspaces/*/action (which includes
# agents/action) and is the least-privilege built-in role that does so.
# Granted at the Cognitive Services ACCOUNT scope, by stable GUID.
resource "azurerm_role_assignment" "uami_foundry_ai_developer" {
  scope                            = module.foundry.resource_id
  role_definition_id               = "/subscriptions/${data.azurerm_client_config.current.subscription_id}/providers/Microsoft.Authorization/roleDefinitions/64702f94-c441-49e6-a78b-ef80e0188fee"
  principal_id                     = module.uami.principal_id
  skip_service_principal_aad_check = true
}

# --- Foundry PROJECT managed identity pulls agent container images from ACR ---
# The platform pulls each agent image using the project's system-assigned MI.
# NOTE: this assignment ALREADY exists in Azure (granted out-of-band; assignment
# GUID 1f697d4d-5cc7-407a-a64c-ba5d2fc4e254). It is intentionally left
# un-managed here for now because `terraform import` aborts on a transient azapi
# data-source auth error during whole-config evaluation. Re-adopt later with:
#   terraform import azurerm_role_assignment.foundry_project_acr_pull \
#     /subscriptions/.../registries/crggga1w2vrg/providers/Microsoft.Authorization/roleAssignments/1f697d4d-5cc7-407a-a64c-ba5d2fc4e254
# resource "azurerm_role_assignment" "foundry_project_acr_pull" {
#   scope                            = module.acr.resource_id
#   role_definition_name             = local.role_acr_pull
#   principal_id                     = azapi_resource.foundry_project.output.identity.principalId
#   skip_service_principal_aad_check = true
# }
