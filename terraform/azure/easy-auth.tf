# -----------------------------------------------------------------------------
# Easy Auth — Microsoft Entra ID (conditional)
#
# Creates an App Registration + Service Principal + client secret,
# then configures Easy Auth on the gateway container app via azapi.
#
# Enable with: var.enable_easy_auth = true
# -----------------------------------------------------------------------------

# --- Entra ID App Registration ---

resource "azuread_application" "dashboard" {
  count            = var.enable_easy_auth ? 1 : 0
  display_name     = "Deployment Dashboard Sandbox"
  sign_in_audience = "AzureADMyOrg"
  owners           = [data.azuread_client_config.current.object_id]

  web {
    redirect_uris = [
      "https://ca-gateway.${azurerm_container_app_environment.main.default_domain}/.auth/login/aad/callback"
    ]

    implicit_grant {
      id_token_issuance_enabled = true
    }
  }
}

resource "time_rotating" "entra_rotation" {
  rotation_days = 180 # auto-rotate every 6 months
}

resource "random_password" "entra_keeper" {
  length  = 1
  special = false
  keepers = {
    rotation_id = time_rotating.entra_rotation.id
  }
}

resource "azuread_application_password" "dashboard" {
  count          = var.enable_easy_auth ? 1 : 0
  application_id = azuread_application.dashboard[0].id
  display_name   = "Easy Auth client secret"
  end_date       = timeadd(time_rotating.entra_rotation.rotation_rfc3339, "4380h") # 6 months after rotation

  lifecycle {
    replace_triggered_by = [random_password.entra_keeper.id]
  }
}

# --- Enable Easy Auth on Gateway (via azapi) ---
# azurerm_container_app does not natively support auth_settings as of ~4.x.
# azapi is the recommended approach.

resource "azapi_resource" "gateway_auth" {
  count     = var.enable_easy_auth ? 1 : 0
  type      = "Microsoft.App/containerApps/authconfigs@2024-03-01"
  name      = "current"
  parent_id = azurerm_container_app.gateway.id

  body = {
    properties = {
      platform = {
        enabled = true
      }
      globalValidation = {
        unauthenticatedClientAction = "RedirectToLoginPage"
        redirectToProvider          = "azureactivedirectory"
      }
      identityProviders = {
        azureActiveDirectory = {
          enabled = true
          registration = {
            openIdIssuer            = "https://sts.windows.net/${data.azurerm_client_config.current.tenant_id}/v2.0"
            clientId                = azuread_application.dashboard[0].client_id
            clientSecretSettingName = "microsoft-provider-authentication-secret"
          }
          validation = {
            allowedAudiences = [azuread_application.dashboard[0].client_id]
          }
        }
      }
    }
  }
}
data "azuread_client_config" "current" {}
