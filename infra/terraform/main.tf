# =====================================================================
# Core foundation: Resource Group, shared identity, observability, KV
# =====================================================================

module "resource_group" {
  source  = "Azure/avm-res-resources-resourcegroup/azurerm"
  version = "0.4.0"

  name             = local.resource_group_name
  location         = var.location
  tags             = local.tags
  enable_telemetry = false
}

# Shared User-Assigned Managed Identity used by all workloads for passwordless auth.
module "uami" {
  source  = "Azure/avm-res-managedidentity-userassignedidentity/azurerm"
  version = "0.5.0"

  name                = "${local.abbrs.managedIdentity}${var.environment_name}-${local.resource_token}"
  location            = var.location
  resource_group_name = module.resource_group.name
  tags                = local.tags
  enable_telemetry    = false
}

module "log_analytics" {
  source  = "Azure/avm-res-operationalinsights-workspace/azurerm"
  version = "0.5.1"

  name                = "${local.abbrs.logAnalytics}${var.environment_name}-${local.resource_token}"
  location            = var.location
  resource_group_name = module.resource_group.name
  tags                = local.tags
  enable_telemetry    = false

  log_analytics_workspace_retention_in_days = 30
  log_analytics_workspace_sku               = "PerGB2018"
}

module "app_insights" {
  count   = var.enable_app_insights ? 1 : 0
  source  = "Azure/avm-res-insights-component/azurerm"
  version = "0.4.0"

  name                = "${local.abbrs.appInsights}${var.environment_name}-${local.resource_token}"
  location            = var.location
  resource_group_name = module.resource_group.name
  tags                = local.tags
  enable_telemetry    = false

  application_type = "web"
  workspace_id     = module.log_analytics.resource_id
}

module "key_vault" {
  source  = "Azure/avm-res-keyvault-vault/azurerm"
  version = "0.10.2"

  name                = "${local.abbrs.keyVault}${var.environment_name}-${local.resource_token}"
  location            = var.location
  resource_group_name = module.resource_group.name
  tenant_id           = data.azurerm_client_config.current.tenant_id
  tags                = local.tags
  enable_telemetry    = false

  sku_name                      = "standard"
  public_network_access_enabled = false # Azure Policy force-disables public access in this subscription; align IaC to avoid perpetual drift.
  purge_protection_enabled      = false

  network_acls = {
    default_action = "Allow"
    bypass         = "AzureServices"
  }

  role_assignments = {
    deployer_officer = {
      role_definition_id_or_name = "Key Vault Secrets Officer"
      principal_id               = local.principal_id
    }
    uami_secrets_user = {
      role_definition_id_or_name = local.role_kv_secrets_user
      principal_id               = module.uami.principal_id
    }
  }
}
