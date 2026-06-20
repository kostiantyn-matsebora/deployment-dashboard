provider "azurerm" {
  features {}
  # subscription_id is required by azurerm v4; set in terraform.tfvars (see terraform.tfvars.example)
  subscription_id = var.subscription_id
}

provider "azuread" {}

provider "azapi" {}
