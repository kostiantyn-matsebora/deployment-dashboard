# -----------------------------------------------------------------------------
# Core
# -----------------------------------------------------------------------------

variable "subscription_id" {
  description = "Azure subscription ID (required by azurerm v4)"
  type        = string
}

variable "location" {
  description = "Azure region for all resources"
  type        = string
  default     = "westeurope"
}

variable "resource_group_name" {
  description = "Name of the resource group"
  type        = string
  default     = "rg-deployment-dashboard"
}

variable "environment" {
  description = "Environment suffix used in resource names (e.g. dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "tags" {
  description = "Tags applied to all resources"
  type        = map(string)
  default     = {}
}

# -----------------------------------------------------------------------------
# Image
# -----------------------------------------------------------------------------

variable "dashboard_version" {
  description = "Docker image tag for all Deployment Dashboard containers (e.g. latest, 0.9.0)"
  type        = string
  default     = "latest"
}

# -----------------------------------------------------------------------------
# VNet / Networking
# -----------------------------------------------------------------------------

variable "vnet_address_space" {
  description = "Address space for the VNet"
  type        = string
  default     = "10.0.0.0/16"
}

variable "subnet_address_prefix" {
  description = "Address prefix for the Container Apps infrastructure subnet. Must be /21+ due to Terraform provider limitation (Azure accepts /27)."
  type        = string
  default     = "10.0.0.0/21"
}

# -----------------------------------------------------------------------------
# Container Apps
# -----------------------------------------------------------------------------

variable "ca_environment_name" {
  description = "Name of the Container Apps Environment"
  type        = string
  default     = "cae-deployment-dashboard"
}

variable "allowed_ip_ranges" {
  description = "IP ranges allowed to access the gateway. Empty list = no restrictions (fully public)."
  type        = list(string)
  default     = []
}

# -----------------------------------------------------------------------------
# PostgreSQL
# -----------------------------------------------------------------------------

variable "pg_sku_name" {
  description = "PostgreSQL Flexible Server SKU (Burstable B1ms is cheapest)"
  type        = string
  default     = "B_Standard_B1ms"
}

variable "pg_storage_mb" {
  description = "PostgreSQL storage in MB (32768 = 32 GB minimum)"
  type        = number
  default     = 32768
}

variable "pg_version" {
  description = "PostgreSQL major version"
  type        = string
  default     = "16"
}

variable "pg_db_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "deployment_dashboard"
}

variable "pg_admin_login" {
  description = "PostgreSQL administrator login"
  type        = string
  default     = "pgadmin"
}

# -----------------------------------------------------------------------------
# Key Vault
# -----------------------------------------------------------------------------

variable "key_vault_name" {
  description = "Key Vault name (must be globally unique, 3-24 alphanumeric chars)"
  type        = string
  default     = "kv-depldash"
}

# -----------------------------------------------------------------------------
# GitHub Fetcher
# -----------------------------------------------------------------------------

variable "github_repos" {
  description = "Comma-separated list of GitHub repos to poll (e.g. owner/repo1,owner/repo2)"
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# Easy Auth (Entra ID)
# -----------------------------------------------------------------------------

variable "enable_easy_auth" {
  description = "Enable Microsoft Entra ID authentication on the gateway"
  type        = bool
  default     = false
}

# -----------------------------------------------------------------------------
# Misc
# -----------------------------------------------------------------------------

variable "history_retention_days" {
  description = "Deployment history retention window (minimum 90)"
  type        = number
  default     = 365
}
