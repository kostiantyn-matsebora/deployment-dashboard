# -----------------------------------------------------------------------------
# PostgreSQL Flexible Server (Burstable B1ms — cheapest tier)
# SKU format: B_Standard_B1ms
# -----------------------------------------------------------------------------

resource "random_password" "pg_password" {
  length  = 24
  special = true
}

resource "azurerm_postgresql_flexible_server" "main" {
  name                = "psql-depldash-${var.environment}"
  location            = var.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = var.tags

  administrator_login    = var.pg_admin_login
  administrator_password = random_password.pg_password.result

  sku_name   = var.pg_sku_name
  version    = var.pg_version
  storage_mb = var.pg_storage_mb

  zone = "1"

  backup_retention_days        = 7
  geo_redundant_backup_enabled = false
  auto_grow_enabled            = false

  authentication {
    active_directory_auth_enabled = true
    password_auth_enabled         = true
    tenant_id                     = data.azurerm_client_config.current.tenant_id
  }
}

# Allow Azure services (including Container Apps) to connect
resource "azurerm_postgresql_flexible_server_firewall_rule" "allow_azure_services" {
  name             = "AllowAzureServices"
  server_id        = azurerm_postgresql_flexible_server.main.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

# Database
resource "azurerm_postgresql_flexible_server_database" "main" {
  name      = var.pg_db_name
  server_id = azurerm_postgresql_flexible_server.main.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

# -----------------------------------------------------------------------------
# AAD Authentication — set managed identity as AAD admin on PostgreSQL
# -----------------------------------------------------------------------------
# This enables AAD auth on the Flexible Server. The managed identity becomes
# both the AAD admin and the DB role used by the API container app.

resource "azurerm_postgresql_flexible_server_active_directory_administrator" "main" {
  server_name         = azurerm_postgresql_flexible_server.main.name
  resource_group_name = azurerm_resource_group.main.name
  tenant_id           = data.azurerm_client_config.current.tenant_id
  object_id           = azurerm_user_assigned_identity.main.principal_id
  principal_name      = azurerm_user_assigned_identity.main.name
  principal_type      = "ServicePrincipal"
}

# Create a PostgreSQL login role for the managed identity.
# Uses Azure CLI (az postgres flexible-server execute) — no psql needed.
# The role name = managed identity client_id (matching POSTGRES_USER env var).
#
# NOT NEEDED: The AAD admin (id-depldash) connects directly without a separate role.
# The admin identity can access all databases. Uncomment only if you set up a
# separate app identity with least-privilege in production.
#
# resource "terraform_data" "create_mi_pg_role" {
#   triggers_replace = [
#     azurerm_postgresql_flexible_server.main.name,
#     azurerm_user_assigned_identity.main.principal_id,
#     var.pg_db_name,
#   ]
# 
#   provisioner "local-exec" {
#     command = <<-EOT
#       az postgres flexible-server execute \
#         --admin-user '${var.pg_admin_login}' \
#         --admin-password '${random_password.pg_password.result}' \
#         --name '${azurerm_postgresql_flexible_server.main.name}' \
#         --database-name '${var.pg_db_name}' \
#         --querytext "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'id-depldash') THEN CREATE ROLE \"id-depldash\" WITH LOGIN; END IF; GRANT ALL PRIVILEGES ON DATABASE \"${var.pg_db_name}\" TO \"id-depldash\"; GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO \"id-depldash\"; GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO \"id-depldash\"; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO \"id-depldash\"; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO \"id-depldash\"; END \$\$;"
#     EOT
#   }

