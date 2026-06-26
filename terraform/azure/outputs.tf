# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "gateway_url" {
  description = "Public URL of the Deployment Dashboard gateway"
  value       = "https://${azurerm_container_app.gateway.ingress[0].fqdn}"
}

output "api_internal_fqdn" {
  description = "Internal FQDN of the API container app"
  value       = azurerm_container_app.api.ingress[0].fqdn
}

output "frontend_internal_fqdn" {
  description = "Internal FQDN of the Frontend container app"
  value       = azurerm_container_app.frontend.ingress[0].fqdn
}

output "postgresql_fqdn" {
  description = "PostgreSQL Flexible Server FQDN"
  value       = azurerm_postgresql_flexible_server.main.fqdn
}

output "key_vault_name" {
  description = "Key Vault name"
  value       = azurerm_key_vault.main.name
}

output "key_vault_secret_names" {
  description = "Secret names in Key Vault (user needs to know these)"
  value = {
    pg_admin_password = "pg-admin-password"
    api_key           = "api-key"
    github_token      = "github-token"
  }
}

output "entra_app_client_id" {
  description = "Entra ID Application (client) ID — N/A if easy auth is disabled"
  value       = var.enable_easy_auth ? azuread_application.dashboard[0].client_id : "N/A"
}

output "resource_group_name" {
  description = "Resource group name"
  value       = azurerm_resource_group.main.name
}

output "container_app_environment_id" {
  description = "Container Apps Environment resource ID"
  value       = azurerm_container_app_environment.main.id
}

output "vnet_id" {
  description = "VNet resource ID"
  value       = azurerm_virtual_network.main.id
}
