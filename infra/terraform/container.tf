# =====================================================================
# Container platform: ACR, Container Apps Environment (Dapr), agent app
# =====================================================================

module "acr" {
  source  = "Azure/avm-res-containerregistry-registry/azurerm"
  version = "0.5.1"

  name                = local.acr_name
  location            = var.location
  resource_group_name = module.resource_group.name
  tags                = local.tags
  enable_telemetry    = false

  sku                           = "Standard"
  public_network_access_enabled = true
  zone_redundancy_enabled       = false

  role_assignments = {
    uami_acr_pull = {
      role_definition_id_or_name = local.role_acr_pull
      principal_id               = module.uami.principal_id
    }
  }
}

module "container_apps_env" {
  source  = "Azure/avm-res-app-managedenvironment/azurerm"
  version = "0.5.0"

  name                = "${local.abbrs.containerAppsEnv}${var.environment_name}-${local.resource_token}"
  location            = var.location
  resource_group_name = module.resource_group.name
  tags                = local.tags
  enable_telemetry    = false

  log_analytics_workspace = {
    resource_id = module.log_analytics.resource_id
  }

  dapr_application_insights_connection_string = var.enable_app_insights ? module.app_insights[0].connection_string : null

  # Workload-profiles environment with a custom VNet so app egress routes
  # through the infrastructure subnet and can reach the Cosmos private
  # endpoint (Cosmos public access is force-disabled by Azure Policy).
  workload_profiles = [
    {
      name                  = "Consumption"
      workload_profile_type = "Consumption"
    }
  ]
  vnet_configuration = {
    infrastructure_subnet_id = azurerm_subnet.cae_infra.id
    internal                 = false
  }

  zone_redundant = false
}
