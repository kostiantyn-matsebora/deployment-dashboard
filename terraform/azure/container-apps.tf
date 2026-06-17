# -----------------------------------------------------------------------------
# Managed Identity (shared by all container apps)
# -----------------------------------------------------------------------------

resource "azurerm_user_assigned_identity" "main" {
  name                = "id-depldash"
  location            = var.location
  resource_group_name = azurerm_resource_group.main.name
}

# =============================================================================
# Container Apps
# =============================================================================

# -----------------------------------------------------------------------------
# Gateway (external ingress — single public surface)
# -----------------------------------------------------------------------------

resource "azurerm_container_app" "gateway" {
  name                         = "ca-gateway"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"
  tags                         = var.tags
  workload_profile_name        = "Consumption"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.main.id]
  }

  # Key Vault secret references
  secret {
    name                = "api-key"
    key_vault_secret_id = azurerm_key_vault_secret.api_key.versionless_id
    identity            = azurerm_user_assigned_identity.main.id
  }

  # Nginx template override — stored as a Container App secret, mounted as a file
  # IMPORTANT: Do NOT base64-encode — Container Apps writes secret values as-is to volume files
  secret {
    name  = "nginx-template"
    value = local.gateway_nginx_template
  }

  # Entra ID client secret for Easy Auth (only when enabled)
  # Stored directly as value to avoid cycle (app reg needs gateway FQDN)
  dynamic "secret" {
    for_each = var.enable_easy_auth ? [1] : []
    content {
      name  = "microsoft-provider-authentication-secret"
      value = azuread_application_password.dashboard[0].value
    }
  }

  ingress {
    external_enabled = true
    target_port      = 8080
    transport        = "http"

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }

    # IP whitelisting — empty list = no restrictions (fully public)
    dynamic "ip_security_restriction" {
      for_each = var.allowed_ip_ranges
      content {
        ip_address_range = ip_security_restriction.value
        action           = "Allow"
        name             = "allow-${ip_security_restriction.key}"
      }
    }
  }

  template {
    # Volume: mount the nginx template secret as a file
    volume {
      name         = "nginx-config"
      storage_type = "Secret"
    }

    container {
      name   = "gateway"
      image  = "ghcr.io/kostiantyn-matsebora/deployment-dashboard-gateway:${var.dashboard_version}"
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "API_UPSTREAM"
        value = azurerm_container_app.api.ingress[0].fqdn
      }
      env {
        name  = "FRONTEND_UPSTREAM"
        value = azurerm_container_app.frontend.ingress[0].fqdn
      }
      env {
        name  = "DEMO_DRIVER_UPSTREAM"
        value = "unused:3001"
      }

      volume_mounts {
        name     = "nginx-config"
        path     = "/etc/nginx/templates/default.conf.template"
        sub_path = "nginx-template"
      }
    }

    min_replicas = 1
    max_replicas = 2
  }

  depends_on = [
    azurerm_key_vault.main,
  ]
}

# -----------------------------------------------------------------------------
# Frontend (internal ingress — Angular SPA served by nginx)
# -----------------------------------------------------------------------------

resource "azurerm_container_app" "frontend" {
  name                         = "ca-frontend"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"
  tags                         = var.tags
  workload_profile_name        = "Consumption"

  ingress {
    external_enabled           = false
    target_port                = 80
    transport                  = "http"
    allow_insecure_connections = true

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  template {
    container {
      name   = "frontend"
      image  = "ghcr.io/kostiantyn-matsebora/deployment-dashboard-spa:${var.dashboard_version}"
      cpu    = 0.25
      memory = "0.5Gi"
    }
    min_replicas = 1
    max_replicas = 2
  }
}

# -----------------------------------------------------------------------------
# API (internal ingress — .NET 10 backend)
# -----------------------------------------------------------------------------

resource "azurerm_container_app" "api" {
  name                         = "ca-api"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"
  tags                         = var.tags
  workload_profile_name        = "Consumption"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.main.id]
  }

  secret {
    name                = "api-key"
    key_vault_secret_id = azurerm_key_vault_secret.api_key.versionless_id
    identity            = azurerm_user_assigned_identity.main.id
  }

  secret {
    name                = "control-api-key"
    key_vault_secret_id = azurerm_key_vault_secret.control_api_key.versionless_id
    identity            = azurerm_user_assigned_identity.main.id
  }

  ingress {
    external_enabled           = false
    target_port                = 8080
    transport                  = "http"
    allow_insecure_connections = true

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  template {
    container {
      name   = "api"
      image  = "ghcr.io/kostiantyn-matsebora/deployment-dashboard-api:${var.dashboard_version}"
      cpu    = 0.5
      memory = "1Gi"

      env {
        name  = "POSTGRES_HOST"
        value = azurerm_postgresql_flexible_server.main.fqdn
      }
      env {
        name  = "POSTGRES_PORT"
        value = "5432"
      }
      env {
        name  = "POSTGRES_DB"
        value = var.pg_db_name
      }
      env {
        name  = "POSTGRES_USER"
        value = "id-depldash"
      }
      env {
        name  = "POSTGRES_AUTH_MODE"
        value = "azure-identity"
      }
      env {
        name        = "API_KEY"
        secret_name = "api-key"
      }
      env {
        name        = "CONTROL_API_KEY"
        secret_name = "control-api-key"
      }
      env {
        name  = "HISTORY_RETENTION_DAYS"
        value = tostring(var.history_retention_days)
      }
      env {
        name  = "ASPNETCORE_URLS"
        value = "http://0.0.0.0:8080"
      }
      env {
        name  = "AZURE_CLIENT_ID"
        value = azurerm_user_assigned_identity.main.client_id
      }

      # Startup probe — .NET needs generous timeouts for cold start
      startup_probe {
        transport       = "HTTP"
        port            = 8080
        path            = "/healthz"
        interval_seconds       = 10
        timeout                 = 5
        failure_count_threshold = 10
      }
    }

    min_replicas = 1
    max_replicas = 2
  }

  depends_on = [
  ]
}

# -----------------------------------------------------------------------------
# Fetcher (no ingress — outbound only, polls GitHub)
# -----------------------------------------------------------------------------

resource "azurerm_container_app" "fetcher" {
  name                         = "ca-fetcher"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"
  tags                         = var.tags
  workload_profile_name        = "Consumption"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.main.id]
  }

  secret {
    name                = "api-key"
    key_vault_secret_id = azurerm_key_vault_secret.api_key.versionless_id
    identity            = azurerm_user_assigned_identity.main.id
  }

  secret {
    name                = "github-token"
    key_vault_secret_id = azurerm_key_vault_secret.github_token.versionless_id
    identity            = azurerm_user_assigned_identity.main.id
  }

  secret {
    name                = "control-api-key"
    key_vault_secret_id = azurerm_key_vault_secret.control_api_key.versionless_id
    identity            = azurerm_user_assigned_identity.main.id
  }

  template {
    container {
      name   = "fetcher"
      image  = "ghcr.io/kostiantyn-matsebora/deployment-dashboard-fetcher:${var.dashboard_version}"
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "DASHBOARD_API_BASE_URL"
        value = "http://${azurerm_container_app.api.ingress[0].fqdn}"
      }
      env {
        name        = "API_KEY"
        secret_name = "api-key"
      }
      env {
        name        = "CONTROL_API_KEY"
        secret_name = "control-api-key"
      }
      env {
        name  = "COMPONENT_ID"
        value = "dashboard-fetcher"
      }
      env {
        name  = "POLL_INTERVAL_SECONDS"
        value = "30"
      }
      env {
        name  = "GITHUB_BASE_URL"
        value = "https://api.github.com"
      }
      env {
        name        = "GITHUB_TOKEN"
        secret_name = "github-token"
      }
      env {
        name  = "GITHUB_REPOS"
        value = var.github_repos
      }
      env {
        name  = "GITHUB_VERSION_SOURCE"
        value = "attribute:sha"
      }
      env {
        name  = "INITIAL_LOOKBACK"
        value = "7.00:00:00"
      }
    }
    min_replicas = 0
    max_replicas = 1
  }
}
