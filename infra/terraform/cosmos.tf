# =====================================================================
# Cosmos DB - agent thread / state / memory store
# =====================================================================

module "cosmos" {
  count   = var.enable_cosmos_db ? 1 : 0
  source  = "Azure/avm-res-documentdb-databaseaccount/azurerm"
  version = "0.10.0"

  name                = "${local.abbrs.cosmos}${var.environment_name}-${local.resource_token}"
  location            = var.location
  resource_group_name = module.resource_group.name
  tags                = local.tags
  enable_telemetry    = false

  public_network_access_enabled = true
  local_authentication_disabled = false

  # westus3 currently lacks zone-redundant Cosmos capacity; pin single-zone.
  geo_locations = [
    {
      location          = var.location
      failover_priority = 0
      zone_redundant    = false
    }
  ]

  consistency_policy = {
    consistency_level = "Session"
  }

  sql_databases = {
    agentstate = {
      name       = "agentstate"
      throughput = 400
      containers = {
        threads = {
          name                = "threads"
          partition_key_paths = ["/sessionId"]
        }
      }
    }
  }
}
