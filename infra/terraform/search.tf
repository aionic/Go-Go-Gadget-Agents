# =====================================================================
# Azure AI Search - hybrid search (vector + keyword + semantic ranker)
# =====================================================================

module "search" {
  source  = "Azure/avm-res-search-searchservice/azurerm"
  version = "0.2.0"

  name                = local.search_name
  location            = var.location
  resource_group_name = module.resource_group.name
  tags                = local.tags
  enable_telemetry    = false

  sku                 = "standard"
  semantic_search_sku = "standard"
  partition_count     = 1
  replica_count       = 1

  public_network_access_enabled = true
  network_rule_bypass_option    = "AzureServices"
  allowed_ips                   = var.restrict_public_ip && local.deployer_ip != "" ? [local.deployer_ip] : []

  # Use Entra ID (RBAC) for data-plane operations.
  local_authentication_enabled = false

  managed_identities = {
    system_assigned = true
  }

  role_assignments = {
    deployer_service_contributor = {
      role_definition_id_or_name = local.role_search_service_ctb
      principal_id               = local.principal_id
    }
    deployer_index_contributor = {
      role_definition_id_or_name = local.role_search_index_data_ctb
      principal_id               = local.principal_id
    }
    uami_index_contributor = {
      role_definition_id_or_name = local.role_search_index_data_ctb
      principal_id               = module.uami.principal_id
    }
  }
}
