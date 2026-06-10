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

  zone_redundant = false
}

# Placeholder self-hosted agent app (image replaced by the agent scaffold later).
module "agent_app" {
  source  = "Azure/avm-res-app-containerapp/azurerm"
  version = "0.9.0"

  name                                  = "${local.abbrs.containerApp}agent-${var.environment_name}-${local.resource_token}"
  resource_group_name                   = module.resource_group.name
  location                              = var.location
  tags                                  = local.tags
  enable_telemetry                      = false
  container_app_environment_resource_id = module.container_apps_env.resource_id
  revision_mode                         = "Single"

  managed_identities = {
    user_assigned_resource_ids = [module.uami.resource_id]
  }

  registries = [
    {
      server   = local.acr_login_server
      identity = module.uami.resource_id
    }
  ]

  template = {
    min_replicas = 0
    max_replicas = 3
    containers = [
      {
        name   = "agent"
        image  = "mcr.microsoft.com/k8se/quickstart:latest"
        cpu    = 0.5
        memory = "1Gi"
        env = [
          { name = "AZURE_CLIENT_ID", value = module.uami.client_id },
          { name = "FOUNDRY_ENDPOINT", value = module.foundry.endpoint },
          { name = "SEARCH_ENDPOINT", value = local.search_endpoint },
          { name = "KEY_VAULT_URI", value = module.key_vault.uri },
        ]
      }
    ]
  }

  dapr = var.enable_dapr ? {
    enabled      = true
    app_id       = "agent"
    app_port     = 80
    app_protocol = "http"
  } : null

  ingress = {
    external_enabled = true
    target_port      = 80
    transport        = "auto"
    traffic_weight = [
      {
        latest_revision = true
        percentage      = 100
      }
    ]
  }
}
