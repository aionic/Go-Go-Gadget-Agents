variable "environment_name" {
  type        = string
  description = "Short environment name used to derive resource names (e.g. 'hack', 'dev'). Lowercase alphanumeric."
  default     = "ggga"

  validation {
    condition     = can(regex("^[a-z0-9]{2,12}$", var.environment_name))
    error_message = "environment_name must be 2-12 lowercase alphanumeric characters."
  }
}

variable "location" {
  type        = string
  description = "Primary Azure region for all resources."
  default     = "westus3"
}

variable "foundry_location" {
  type        = string
  description = "Region for the Azure AI Foundry account and model deployments. Defaults to eastus2 for model availability; override to match `location` if models are available there."
  default     = "eastus2"
}

variable "resource_group_name" {
  type        = string
  description = "Optional explicit resource group name. If empty, one is generated."
  default     = ""
}

variable "tags" {
  type        = map(string)
  description = "Tags applied to all resources."
  default     = {}
}

# ------------------------------------------------------------------
# Model deployment configuration
# ------------------------------------------------------------------
variable "llm_deployment" {
  type = object({
    name     = string
    model    = string
    version  = string
    capacity = number
    sku      = string
  })
  description = "LLM (chat) model deployment for the agents' reasoning endpoint."
  default = {
    name     = "gpt-5.4-mini"
    model    = "gpt-5.4-mini"
    version  = "2026-03-17"
    capacity = 50
    sku      = "GlobalStandard"
  }
}

variable "embedding_deployment" {
  type = object({
    name     = string
    model    = string
    version  = string
    capacity = number
    sku      = string
  })
  description = "Embeddings model deployment used by Azure AI Search integrated vectorization."
  default = {
    name     = "text-embedding-3-large"
    model    = "text-embedding-3-large"
    version  = "1"
    capacity = 50
    sku      = "Standard"
  }
}

# ------------------------------------------------------------------
# PostgreSQL
# ------------------------------------------------------------------
variable "postgres_administrator_login" {
  type        = string
  description = "PostgreSQL administrator login name (password auth)."
  default     = "pgadmin"
}

variable "postgres_database_name" {
  type        = string
  description = "Application database created on the flexible server."
  default     = "agentdb"
}

variable "entra_admin_principal_type" {
  type        = string
  description = "Principal type of the deployer set as the PostgreSQL Entra admin. Use 'User' for interactive az login, 'ServicePrincipal' for CI/automation."
  default     = "User"

  validation {
    condition     = contains(["User", "Group", "ServicePrincipal"], var.entra_admin_principal_type)
    error_message = "entra_admin_principal_type must be one of: User, Group, ServicePrincipal."
  }
}

variable "enable_pgvector" {
  type        = bool
  description = "Enable the pgvector ('vector') extension on PostgreSQL."
  default     = true
}

variable "run_postgres_seed" {
  type        = bool
  description = "Run the post-provision schema build + sample data seed (requires uv + network access to the server)."
  default     = true
}

# ------------------------------------------------------------------
# Feature toggles (add-ons)
# ------------------------------------------------------------------
variable "enable_app_insights" {
  type        = bool
  description = "Provision Application Insights for agent distributed tracing."
  default     = true
}

variable "enable_cosmos_db" {
  type        = bool
  description = "Provision Cosmos DB for agent thread/state/memory."
  default     = true
}

variable "enable_document_intelligence" {
  type        = bool
  description = "Provision Document Intelligence for complex document parsing before Search ingestion."
  default     = true
}

# ------------------------------------------------------------------
# Networking
# ------------------------------------------------------------------
variable "allowed_ip_address" {
  type        = string
  description = "Public IP address (single IP) allowed through firewalls (Postgres, Search, Storage). Leave empty to auto-detect the deployer's IP."
  default     = ""
}

variable "restrict_public_ip" {
  type        = bool
  description = <<DESCRIPTION
  Whether to restrict AI Search public access to a single allow-listed IP. Set to false to
  rely on Entra RBAC only (no IP filter) when the client's egress IP is unstable (e.g. corporate
  networks where the egress IP varies by destination) or when Azure-hosted agents must reach the
  service. Local auth stays disabled, so access is always RBAC-gated.
  DESCRIPTION
  default     = true
}

variable "principal_id" {
  type        = string
  description = "Object ID of the deploying user/principal to grant data-plane admin roles. Leave empty to auto-detect via azurerm client config."
  default     = ""
}
