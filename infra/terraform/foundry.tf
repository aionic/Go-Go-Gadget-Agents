# =====================================================================
# Azure AI Foundry (AIServices) account, project, and model deployments
# =====================================================================

locals {
  foundry_account_name = "${local.abbrs.foundryAccount}${var.environment_name}-${local.resource_token}"
}

module "foundry" {
  source  = "Azure/avm-res-cognitiveservices-account/azurerm"
  version = "0.11.0"

  name             = local.foundry_account_name
  location         = var.foundry_location
  parent_id        = module.resource_group.resource_id
  tags             = local.tags
  enable_telemetry = false

  kind                          = "AIServices"
  sku_name                      = "S0"
  custom_subdomain_name         = local.foundry_account_name
  public_network_access_enabled = true
  local_auth_enabled            = false
  allow_project_management      = true

  managed_identities = {
    system_assigned = true
  }

  cognitive_deployments = {
    llm = {
      name = var.llm_deployment.name
      model = {
        format  = "OpenAI"
        name    = var.llm_deployment.model
        version = var.llm_deployment.version
      }
      scale = {
        type     = var.llm_deployment.sku
        capacity = var.llm_deployment.capacity
      }
    }
    embedding = {
      name = var.embedding_deployment.name
      model = {
        format  = "OpenAI"
        name    = var.embedding_deployment.model
        version = var.embedding_deployment.version
      }
      scale = {
        type     = var.embedding_deployment.sku
        capacity = var.embedding_deployment.capacity
      }
    }
  }
}

# Foundry project (newer child resource) provisioned via AzAPI shim.
resource "azapi_resource" "foundry_project" {
  type      = "Microsoft.CognitiveServices/accounts/projects@2025-06-01"
  name      = "${var.environment_name}-agents"
  parent_id = module.foundry.resource_id
  location  = var.foundry_location
  tags      = local.tags

  identity {
    type = "SystemAssigned"
  }

  body = {
    properties = {
      displayName = "Go-Go-Gadget Agents"
      description = "Self-hosted multi-agent workspace for the hackathon environment."
    }
  }

  response_export_values = ["identity.principalId", "properties.endpoints"]
}

# =====================================================================
# Document Intelligence (parse complex docs before Search ingestion)
# =====================================================================

module "document_intelligence" {
  count   = var.enable_document_intelligence ? 1 : 0
  source  = "Azure/avm-res-cognitiveservices-account/azurerm"
  version = "0.11.0"

  name             = "${local.abbrs.docIntelligence}${var.environment_name}-${local.resource_token}"
  location         = var.foundry_location
  parent_id        = module.resource_group.resource_id
  tags             = local.tags
  enable_telemetry = false

  kind                          = "FormRecognizer"
  sku_name                      = "S0"
  custom_subdomain_name         = "${local.abbrs.docIntelligence}${var.environment_name}-${local.resource_token}"
  public_network_access_enabled = true
  local_auth_enabled            = false

  managed_identities = {
    system_assigned = true
  }
}
