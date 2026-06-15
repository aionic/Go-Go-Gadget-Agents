# =====================================================================
# Networking — VNet for the workload-profiles Container Apps Environment
# plus a private endpoint so the apps can reach Cosmos DB (public access
# is force-disabled by Azure Policy).
#
# Egress from a workload-profiles environment with a custom VNet routes
# through the infrastructure subnet, so the apps resolve the Cosmos
# private endpoint via the linked private DNS zone while still reaching
# public endpoints (Foundry, ACR) over the internet.
# =====================================================================

resource "azurerm_virtual_network" "main" {
  name                = "vnet-${var.environment_name}-${local.resource_token}"
  location            = var.location
  resource_group_name = module.resource_group.name
  address_space       = ["10.0.0.0/16"]
  tags                = local.tags
}

# Infrastructure subnet for the Container Apps Environment (workload
# profiles). Must be delegated to Microsoft.App/environments and be at
# least /27; /23 is the recommended size.
resource "azurerm_subnet" "cae_infra" {
  name                 = "snet-cae-infra"
  resource_group_name  = module.resource_group.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.0.0/23"]

  delegation {
    name = "app-environments"
    service_delegation {
      name    = "Microsoft.App/environments"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

# Dedicated subnet for private endpoints.
resource "azurerm_subnet" "private_endpoints" {
  name                              = "snet-pe"
  resource_group_name               = module.resource_group.name
  virtual_network_name              = azurerm_virtual_network.main.name
  address_prefixes                  = ["10.0.2.0/27"]
  private_endpoint_network_policies = "Disabled"
}

# ------------------------------------------------------------------
# Cosmos DB private endpoint + private DNS
# ------------------------------------------------------------------
resource "azurerm_private_dns_zone" "cosmos" {
  count               = var.enable_cosmos_db ? 1 : 0
  name                = "privatelink.documents.azure.com"
  resource_group_name = module.resource_group.name
  tags                = local.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "cosmos" {
  count                 = var.enable_cosmos_db ? 1 : 0
  name                  = "cosmos-dns-link"
  resource_group_name   = module.resource_group.name
  private_dns_zone_name = azurerm_private_dns_zone.cosmos[0].name
  virtual_network_id    = azurerm_virtual_network.main.id
  registration_enabled  = false
  tags                  = local.tags
}

resource "azurerm_private_endpoint" "cosmos" {
  count               = var.enable_cosmos_db ? 1 : 0
  name                = "pe-${module.cosmos[0].name}"
  location            = var.location
  resource_group_name = module.resource_group.name
  subnet_id           = azurerm_subnet.private_endpoints.id
  tags                = local.tags

  private_service_connection {
    name                           = "cosmos-sql"
    private_connection_resource_id = module.cosmos[0].resource_id
    subresource_names              = ["Sql"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "cosmos-dns-zone-group"
    private_dns_zone_ids = [azurerm_private_dns_zone.cosmos[0].id]
  }
}
