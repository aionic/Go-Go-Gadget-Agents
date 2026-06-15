# =====================================================================
# PostgreSQL Flexible Server (Entra + password admin, pgvector)
# =====================================================================

resource "random_password" "postgres" {
  length           = 24
  special          = true
  override_special = "!#$%*-_=+"
  min_lower        = 2
  min_upper        = 2
  min_numeric      = 2
  min_special      = 2
}

module "postgres" {
  source  = "Azure/avm-res-dbforpostgresql-flexibleserver/azurerm"
  version = "0.2.2"

  name                = "${local.abbrs.postgres}${var.environment_name}-${local.resource_token}"
  location            = var.location
  resource_group_name = module.resource_group.name
  tags                = local.tags
  enable_telemetry    = false

  sku_name          = "GP_Standard_D2ds_v5"
  storage_mb        = 32768
  server_version    = "16"
  high_availability = null

  administrator_login    = var.postgres_administrator_login
  administrator_password = random_password.postgres.result

  # Entra (AAD) auth enabled alongside password auth; deployer set as an AAD admin.
  authentication = {
    active_directory_auth_enabled = true
    password_auth_enabled         = true
    tenant_id                     = data.azurerm_client_config.current.tenant_id
  }

  ad_administrator = {
    deployer = {
      tenant_id      = data.azurerm_client_config.current.tenant_id
      object_id      = local.principal_id
      principal_name = "deployer-admin"
      principal_type = var.entra_admin_principal_type
    }
  }

  databases = {
    appdb = {
      name      = var.postgres_database_name
      collation = "en_US.utf8"
      charset   = "UTF8"
    }
  }

  # Allow Azure services and the deployer's public IP through the firewall.
  firewall_rules = {
    allow_azure_services = {
      name             = "AllowAllAzureServices"
      start_ip_address = "0.0.0.0"
      end_ip_address   = "0.0.0.0"
    }
    allow_deployer = {
      name             = "AllowDeployerIP"
      start_ip_address = local.deployer_ip
      end_ip_address   = local.deployer_ip
    }
  }

  # Enable the pgvector extension via server parameter.
  server_configuration = var.enable_pgvector ? {
    azure_extensions = {
      name   = "azure.extensions"
      config = "VECTOR"
    }
  } : {}
}

# Allow Key Vault data-plane RBAC (deployer Secrets Officer) to propagate
# before writing secrets, otherwise the first secret write can 403.
resource "time_sleep" "kv_rbac_propagation" {
  depends_on      = [module.key_vault]
  create_duration = "90s"
}

# Store generated admin password + connection string in Key Vault.
# Key Vault public network access is force-disabled by Azure Policy in this
# subscription, so data-plane secret writes cannot run from outside the VNet
# (e.g. a local Terraform run). These secrets are gated off by default; enable
# only when applying from within private networking. The architecture is
# passwordless (managed identity) so these are optional convenience secrets.
variable "manage_kv_secrets" {
  description = "Manage the postgres-* Key Vault secrets. Requires Key Vault data-plane reachability (private networking), so keep false for local/public-blocked runs."
  type        = bool
  default     = false
}

resource "azurerm_key_vault_secret" "postgres_password" {
  count        = var.manage_kv_secrets ? 1 : 0
  name         = "postgres-admin-password"
  value        = random_password.postgres.result
  key_vault_id = module.key_vault.resource_id

  depends_on = [time_sleep.kv_rbac_propagation]
}

resource "azurerm_key_vault_secret" "postgres_connection_string" {
  count        = var.manage_kv_secrets ? 1 : 0
  name         = "postgres-connection-string"
  value        = "host=${module.postgres.fqdn} port=5432 dbname=${var.postgres_database_name} user=${var.postgres_administrator_login} password=${random_password.postgres.result} sslmode=require"
  key_vault_id = module.key_vault.resource_id

  depends_on = [time_sleep.kv_rbac_propagation]
}
