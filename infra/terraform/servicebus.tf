# =====================================================================
# Service Bus - async multi-agent / multi-step orchestration backbone
# =====================================================================

module "service_bus" {
  count   = var.enable_service_bus ? 1 : 0
  source  = "Azure/avm-res-servicebus-namespace/azurerm"
  version = "0.4.0"

  name                = "${local.abbrs.serviceBus}${var.environment_name}-${local.resource_token}"
  location            = var.location
  resource_group_name = module.resource_group.name
  tags                = local.tags
  enable_telemetry    = false

  sku                           = "Standard"
  public_network_access_enabled = true
  local_auth_enabled            = false # Azure Policy disables SAS; UAMI + deployer use data-owner RBAC roles below.

  queues = {
    agent_tasks = {
      name = "agent-tasks"
    }
  }

  topics = {
    agent_events = {
      name = "agent-events"
    }
  }

  role_assignments = {
    uami_data_owner = {
      role_definition_id_or_name = local.role_servicebus_data_owner
      principal_id               = module.uami.principal_id
    }
    deployer_data_owner = {
      role_definition_id_or_name = local.role_servicebus_data_owner
      principal_id               = local.principal_id
    }
  }
}
