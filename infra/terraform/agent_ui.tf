# =====================================================================
# Agent UI — Next.js chat front end (Container App)
#
# Reuses the shared UAMI (passwordless), ACR (image pull), and the
# Dapr-enabled Container Apps Environment. The UI authenticates users with
# Entra ID (identity-only sign-in) and proxies chat to the Foundry agent
# server-side using the managed identity, so no resource credential ever
# reaches the browser.
# =====================================================================

locals {
  agent_ui_name = "${local.abbrs.containerApp}ui-${var.environment_name}-${local.resource_token}"

  # Foundry *project* endpoint for the hosted agents (Responses protocol).
  # Override via var.foundry_project_endpoint; otherwise derive the unified
  # services host.
  foundry_project_endpoint = var.foundry_project_endpoint != "" ? var.foundry_project_endpoint : "https://${local.foundry_account_name}.services.ai.azure.com/api/projects/${azapi_resource.foundry_project.name}"
}

# Read the Container Apps Environment default domain so the UI's own ingress
# FQDN (and therefore the Entra redirect URI) is known before the app exists.
data "azurerm_container_app_environment" "cae" {
  name                = module.container_apps_env.name
  resource_group_name = module.resource_group.name
}

locals {
  agent_ui_fqdn         = "${local.agent_ui_name}.${data.azurerm_container_app_environment.cae.default_domain}"
  agent_ui_redirect_uri = "https://${local.agent_ui_fqdn}"
}

# The UAMI's "Azure AI User" role (used to invoke the Foundry hosted agents)
# is declared in rbac.tf (azurerm_role_assignment.uami_foundry_ai_user).
#
# Entra client secret as a native Container App secret (encrypted by the
# platform, surfaced to the app via secretRef — never a plaintext env value).
# NOTE: the project's Key Vault has public network access disabled by Azure
# Policy with no private endpoint, so a KV-backed secret can be neither written
# by Terraform (deployer has no network path) nor read by the app. Revisit a
# KV-backed secret once a Key Vault private endpoint is added to the CAE VNet.

module "agent_ui" {
  source  = "Azure/avm-res-app-containerapp/azurerm"
  version = "0.9.0"

  name                                  = local.agent_ui_name
  resource_group_name                   = module.resource_group.name
  location                              = var.location
  tags                                  = local.tags
  enable_telemetry                      = false
  container_app_environment_resource_id = module.container_apps_env.resource_id
  revision_mode                         = "Single"
  workload_profile_name                 = "Consumption"

  managed_identities = {
    user_assigned_resource_ids = [module.uami.resource_id]
  }

  registries = [
    {
      server   = local.acr_login_server
      identity = module.uami.resource_id
    }
  ]

  # Native Container App secret (encrypted at rest by the platform); the env
  # var below references it by name so the value never appears in plaintext.
  secrets = var.azure_ad_client_secret != "" ? {
    azure_ad_client_secret = {
      name  = "azure-ad-client-secret"
      value = var.azure_ad_client_secret
    }
  } : null

  template = {
    min_replicas = 1
    max_replicas = 3
    containers = [
      {
        name   = "agent-ui"
        image  = var.agent_ui_image
        cpu    = 0.25
        memory = "0.5Gi"
        env = concat([
          # Managed-identity selection for DefaultAzureCredential (server-side
          # Foundry calls).
          { name = "AZURE_CLIENT_ID", value = module.uami.client_id },

          # Foundry agent target (server-side proxy). The chat route invokes
          # the hosted agents (ggga-planner -> ggga-researcher -> ggga-writer)
          # over the Responses protocol; set DEMO_MULTI_AGENT=false for live
          # agents. Agent names default in code; override via *_AGENT_NAME.
          { name = "FOUNDRY_PROJECT_ENDPOINT", value = local.foundry_project_endpoint },
          { name = "DEMO_MULTI_AGENT", value = "false" },

          # Entra ID sign-in (identity-only).
          { name = "AZURE_AD_CLIENT_ID", value = var.azure_ad_client_id },
          { name = "AZURE_AD_TENANT_ID", value = data.azurerm_client_config.current.tenant_id },
          { name = "REDIRECT_URI", value = local.agent_ui_redirect_uri },
          ],
          # Cosmos DB feedback persistence (passwordless via the shared UAMI).
          var.enable_cosmos_db ? [
            { name = "COSMOS_ENDPOINT", value = module.cosmos[0].endpoint },
            { name = "COSMOS_DATABASE", value = "agentstate" },
            { name = "COSMOS_FEEDBACK_CONTAINER", value = "feedback" },
          ] : [],
          var.azure_ad_client_secret != "" ? [
            { name = "AZURE_AD_CLIENT_SECRET", secret_name = "azure-ad-client-secret" }
        ] : [])
      }
    ]
  }

  ingress = {
    external_enabled = true
    target_port      = 3000
    transport        = "auto"
    traffic_weight = [
      {
        latest_revision = true
        percentage      = 100
      }
    ]
  }
}

# ------------------------------------------------------------------
# Variables
# ------------------------------------------------------------------
variable "agent_ui_image" {
  type        = string
  description = "Container image for the agent UI. Defaults to a placeholder; replace with the pushed image (e.g. <acr>.azurecr.io/agent-ui:<tag>) after building."
  default     = "mcr.microsoft.com/k8se/quickstart:latest"
}

variable "foundry_project_endpoint" {
  type        = string
  description = "Explicit Foundry project endpoint for the hosted-agent Responses protocol. If empty, derived from the account subdomain + project name."
  default     = ""
}

variable "azure_ad_client_id" {
  type        = string
  description = "Entra ID application (client) ID used for UI sign-in. Configure a web platform redirect URI matching the app's https FQDN."
  default     = ""
}

variable "azure_ad_client_secret" {
  type        = string
  description = "Entra ID client secret for the confidential-client token exchange. Optional for PKCE public-client flows. Stored as a native (encrypted) Container App secret and surfaced via secretRef — never a plaintext container env value. Supply via a gitignored tfvars or TF_VAR_azure_ad_client_secret."
  default     = ""
  sensitive   = true
}

# ------------------------------------------------------------------
# Outputs
# ------------------------------------------------------------------
output "agent_ui_fqdn" {
  value       = module.agent_ui.fqdn_url
  description = "Public URL of the agent UI Container App."
}

output "agent_ui_redirect_uri" {
  value       = local.agent_ui_redirect_uri
  description = "Redirect URI to register on the Entra app's web platform."
}

output "foundry_project_endpoint" {
  value       = local.foundry_project_endpoint
  description = "Foundry project endpoint consumed by the UI (hosted-agent Responses protocol)."
}
