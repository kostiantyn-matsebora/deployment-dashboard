# -----------------------------------------------------------------------------
# Resource Group
# -----------------------------------------------------------------------------

resource "azurerm_resource_group" "main" {
  name     = var.resource_group_name
  location = var.location
  tags     = var.tags
}

# -----------------------------------------------------------------------------
# VNet + Subnet (required for Workload Profiles environment)
# -----------------------------------------------------------------------------

resource "azurerm_virtual_network" "main" {
  name                = "vnet-depldash"
  location            = var.location
  resource_group_name = azurerm_resource_group.main.name
  address_space       = [var.vnet_address_space]
  tags                = var.tags
}

resource "azurerm_subnet" "infrastructure" {
  name                 = "snet-infrastructure"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [var.subnet_address_prefix]

  delegation {
    name = "container-apps"
    service_delegation {
      name    = "Microsoft.App/environments"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

# -----------------------------------------------------------------------------
# Container Apps Environment (Workload Profiles v2)
# -----------------------------------------------------------------------------

resource "azurerm_container_app_environment" "main" {
  name                     = var.ca_environment_name
  location                 = var.location
  resource_group_name      = azurerm_resource_group.main.name
  tags                     = var.tags
  infrastructure_subnet_id = azurerm_subnet.infrastructure.id

  # Consumption profile is required for Workload Profiles environments.
  # If omitted, it cannot be added later (requires environment recreation).
  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
    maximum_count         = 0
    minimum_count         = 0
  }

  depends_on = [
    azurerm_subnet.infrastructure,
  ]
}
