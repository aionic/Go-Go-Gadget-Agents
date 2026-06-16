# Resource name abbreviations (CAF-aligned), mirrored from the org template.
locals {
  abbrs = {
    resourceGroup     = "rg-"
    managedIdentity   = "id-"
    logAnalytics      = "log-"
    appInsights       = "appi-"
    keyVault          = "kv-"
    storageAccount    = "st"
    searchService     = "srch-"
    cognitiveAccount  = "cog-"
    foundryAccount    = "aif-"
    docIntelligence   = "di-"
    postgres          = "psql-"
    cosmos            = "cosmos-"
    containerRegistry = "cr"
    containerAppsEnv  = "cae-"
    containerApp      = "ca-"
  }
}

# Deterministic short token for globally-unique resource names.
resource "random_string" "token" {
  length  = 6
  lower   = true
  upper   = false
  numeric = true
  special = false
}

data "azurerm_client_config" "current" {}

# Auto-detect the deployer's public IP when not explicitly provided.
data "http" "deployer_ip" {
  count = var.allowed_ip_address == "" ? 1 : 0
  url   = "https://api.ipify.org"
}

locals {
  resource_token = random_string.token.result

  resource_group_name = var.resource_group_name != "" ? var.resource_group_name : "${local.abbrs.resourceGroup}${var.environment_name}-${local.resource_token}"

  principal_id = var.principal_id != "" ? var.principal_id : data.azurerm_client_config.current.object_id

  deployer_ip = var.allowed_ip_address != "" ? var.allowed_ip_address : trimspace(try(data.http.deployer_ip[0].response_body, ""))

  tags = merge(
    {
      "azd-env-name"     = var.environment_name
      "workload"         = "go-go-gadget-agents"
      "deployment-phase" = "phase-01-infrastructure"
      "managed-by"       = "terraform"
    },
    var.tags
  )

  # Common AVM role definition names used across modules.
  role_kv_secrets_user       = "Key Vault Secrets User"
  role_acr_pull              = "AcrPull"
  role_blob_data_contributor = "Storage Blob Data Contributor"
  role_blob_data_reader      = "Storage Blob Data Reader"
  role_openai_user           = "Cognitive Services OpenAI User"
  role_search_index_data_ctb = "Search Index Data Contributor"
  role_search_index_data_rdr = "Search Index Data Reader"
  role_search_service_ctb    = "Search Service Contributor"

  # Reused resource names (modules that don't emit a name/url output).
  search_name = "${local.abbrs.searchService}${var.environment_name}-${local.resource_token}"
  acr_name    = "${local.abbrs.containerRegistry}${var.environment_name}${local.resource_token}"

  search_endpoint       = "https://${local.search_name}.search.windows.net"
  acr_login_server      = "${local.acr_name}.azurecr.io"
  storage_blob_endpoint = "https://${local.abbrs.storageAccount}${var.environment_name}${local.resource_token}.blob.core.windows.net"
}
