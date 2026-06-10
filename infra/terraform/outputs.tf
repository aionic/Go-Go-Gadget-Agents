output "resource_group_name" {
  value       = module.resource_group.name
  description = "Name of the resource group containing all resources."
}

output "location" {
  value       = var.location
  description = "Primary region."
}

output "user_assigned_identity_client_id" {
  value       = module.uami.client_id
  description = "Client ID of the shared User-Assigned Managed Identity (AZURE_CLIENT_ID for agents)."
}

output "user_assigned_identity_resource_id" {
  value       = module.uami.resource_id
  description = "Resource ID of the shared User-Assigned Managed Identity."
}

output "key_vault_uri" {
  value       = module.key_vault.uri
  description = "Key Vault URI."
}

output "log_analytics_workspace_id" {
  value       = module.log_analytics.resource_id
  description = "Log Analytics workspace resource ID."
}

output "app_insights_connection_string" {
  value       = var.enable_app_insights ? module.app_insights[0].connection_string : null
  description = "Application Insights connection string for agent tracing."
  sensitive   = true
}

output "storage_blob_endpoint" {
  value       = local.storage_blob_endpoint
  description = "Primary blob endpoint (RAG source container: rag-source)."
}

output "foundry_endpoint" {
  value       = module.foundry.endpoint
  description = "Azure AI Foundry (AIServices) endpoint."
}

output "foundry_project_endpoints" {
  value       = try(azapi_resource.foundry_project.output.properties.endpoints, null)
  description = "Foundry project endpoints."
}

output "llm_deployment_name" {
  value       = var.llm_deployment.name
  description = "Deployed LLM model name."
}

output "embedding_deployment_name" {
  value       = var.embedding_deployment.name
  description = "Deployed embeddings model name."
}

output "document_intelligence_endpoint" {
  value       = var.enable_document_intelligence ? module.document_intelligence[0].endpoint : null
  description = "Document Intelligence endpoint."
}

output "search_endpoint" {
  value       = local.search_endpoint
  description = "Azure AI Search endpoint."
}

output "postgres_fqdn" {
  value       = module.postgres.fqdn
  description = "PostgreSQL Flexible Server FQDN."
}

output "postgres_database_name" {
  value       = var.postgres_database_name
  description = "Application database name."
}

output "cosmos_endpoint" {
  value       = var.enable_cosmos_db ? module.cosmos[0].endpoint : null
  description = "Cosmos DB account endpoint (agent state store)."
}

output "service_bus_namespace" {
  value       = var.enable_service_bus ? "${local.abbrs.serviceBus}${var.environment_name}-${local.resource_token}.servicebus.windows.net" : null
  description = "Service Bus namespace FQDN."
}

output "acr_login_server" {
  value       = local.acr_login_server
  description = "Azure Container Registry login server for agent images."
}

output "container_apps_environment_id" {
  value       = module.container_apps_env.resource_id
  description = "Container Apps Environment resource ID."
}

output "agent_app_fqdn" {
  value       = module.agent_app.fqdn_url
  description = "Public URL of the placeholder agent Container App."
}
