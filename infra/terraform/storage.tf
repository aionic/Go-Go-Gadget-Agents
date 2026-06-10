# =====================================================================
# Storage account (RAG enrichment source for Azure AI Search)
# =====================================================================

module "storage" {
  source  = "Azure/avm-res-storage-storageaccount/azurerm"
  version = "0.7.2"

  name             = "${local.abbrs.storageAccount}${var.environment_name}${local.resource_token}"
  location         = var.location
  parent_id        = module.resource_group.resource_id
  tags             = local.tags
  enable_telemetry = false

  account_tier                  = "Standard"
  account_replication_type      = "LRS"
  account_kind                  = "StorageV2"
  https_traffic_only_enabled    = true
  min_tls_version               = "TLS1_2"
  shared_access_key_enabled     = false
  public_network_access_enabled = true

  network_rules = {
    default_action = "Allow"
    bypass         = ["AzureServices"]
  }

  containers = {
    rag_source = {
      name                  = "rag-source"
      container_access_type = "None"
    }
  }

  role_assignments = {
    uami_blob_contributor = {
      role_definition_id_or_name = local.role_blob_data_contributor
      principal_id               = module.uami.principal_id
    }
    deployer_blob_contributor = {
      role_definition_id_or_name = local.role_blob_data_contributor
      principal_id               = local.principal_id
    }
  }
}
