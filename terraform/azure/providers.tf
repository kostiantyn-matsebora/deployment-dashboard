provider "azurerm" {
  features {}
  # subscription_id passed via ARM_SUBSCRIPTION_ID env var or az login
}

provider "azuread" {}

provider "azapi" {}
