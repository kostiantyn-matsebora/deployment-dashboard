# -----------------------------------------------------------------------------
# Key Vault + Secrets
# -----------------------------------------------------------------------------

data "azurerm_client_config" "current" {}

resource "azurerm_key_vault" "main" {
  name                = var.key_vault_name
  location            = var.location
  resource_group_name = azurerm_resource_group.main.name
  tenant_id           = data.azurerm_client_config.current.tenant_id
  sku_name            = "standard"

  purge_protection_enabled   = false
  soft_delete_retention_days = 7

  # Grant the Terraform caller full secret access
  access_policy {
    tenant_id = data.azurerm_client_config.current.tenant_id
    object_id = data.azurerm_client_config.current.object_id

    secret_permissions = [
      "Get", "List", "Set", "Delete", "Purge", "Recover"
    ]
  }

  # Grant the managed identity read access to secrets
  access_policy {
    tenant_id = data.azurerm_client_config.current.tenant_id
    object_id = azurerm_user_assigned_identity.main.principal_id

    secret_permissions = ["Get", "List"]
  }
}

# --- Generated secrets ---

# Admin password — stored for manual psql / pgAdmin connections
resource "azurerm_key_vault_secret" "pg_password" {
  name         = "pg-admin-password"
  value        = random_password.pg_password.result
  key_vault_id = azurerm_key_vault.main.id
}

resource "random_password" "api_key" {
  length  = 32
  special = false
}

resource "azurerm_key_vault_secret" "api_key" {
  name         = "api-key"
  value        = random_password.api_key.result
  key_vault_id = azurerm_key_vault.main.id
}

# --- Placeholder: set the real GitHub PAT manually after apply ---

resource "azurerm_key_vault_secret" "github_token" {
  name         = "github-token"
  value        = "PLACEHOLDER_SET_ME_MANUALLY"
  key_vault_id = azurerm_key_vault.main.id

  lifecycle {
    ignore_changes = [value]
  }
}

resource "random_password" "control_api_key" {
  length  = 32
  special = false
}

resource "azurerm_key_vault_secret" "control_api_key" {
  name         = "control-api-key"
  value        = random_password.control_api_key.result
  key_vault_id = azurerm_key_vault.main.id
}
