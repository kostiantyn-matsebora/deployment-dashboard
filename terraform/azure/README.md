# Terraform Module — Azure Container Apps

Deploy the [Deployment Dashboard](https://kostiantyn-matsebora.github.io/deployment-dashboard/) on Azure using Container Apps and PostgreSQL Flexible Server with managed identity authentication.

## Architecture

| Component | Azure Resource | Ingress |
|-----------|---------------|---------|
| Gateway | Container App (nginx) | External — public URL |
| Frontend | Container App (Angular SPA) | Internal — `http://ca-frontend` |
| API | Container App (.NET 10) | Internal — `http://ca-api:8080` |
| Fetcher | Container App (GitHub poller) | None — outbound only |
| PostgreSQL | Flexible Server (B1ms) | VNet — AAD auth |
| Key Vault | Standard | Secrets (API key, admin password, GitHub token) |

### Authentication

- **API → PostgreSQL**: Managed identity (AAD token, no static password)
- **Fetcher → API**: API Key (`X-Api-Key` header, via internal FQDN)
- **Gateway**: Optional Easy Auth (Entra ID, off by default)
- **Secrets in Key Vault**: Read via managed identity

### DNS / Service Discovery

The gateway nginx uses `resolver 168.63.129.16` (Azure DNS) instead of Docker's `127.0.0.11`. Container Apps provides automatic DNS resolution for app names within the environment.

## Prerequisites

- Azure CLI authenticated (`az login`)
- Terraform >= 1.5
- `rdbms-connect` Azure CLI extension (for PostgreSQL provisioning)

```bash
az extension add --name rdbms-connect
```

## Quick Start

```bash
cd terraform/azure

# Copy example tfvars and edit
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values

# Initialize and apply
terraform init
terraform plan
terraform apply
```

## Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `location` | `westeurope` | Azure region |
| `resource_group_name` | `rg-deployment-dashboard` | Resource group |
| `environment` | `dev` | Environment suffix |
| `dashboard_version` | `latest` | Docker image tag |
| `pg_sku_name` | `B_Standard_B1ms` | PostgreSQL SKU |
| `pg_admin_login` | `pgadmin` | PostgreSQL admin user |
| `github_repos` | `""` | Comma-separated repos for fetcher |
| `enable_easy_auth` | `false` | Entra ID on gateway |
| `allowed_ip_ranges` | `[]` | IP whitelist for gateway |
| `history_retention_days` | `365` | Deployment history window |

## Outputs

| Output | Description |
|--------|-------------|
| `gateway_url` | Public URL |
| `api_internal_fqdn` | API internal FQDN |
| `frontend_internal_fqdn` | Frontend internal FQDN |
| `postgresql_fqdn` | PostgreSQL FQDN |
| `key_vault_name` | Key Vault name |
| `key_vault_secret_names` | Secret names in Key Vault |

## Post-Deploy

1. **Set GitHub token** (if using fetcher):
   ```bash
   az keyvault secret set --vault-name <kv-name> --name github-token --value <pat>
   ```

2. **Get the API key** (for push-mode CI/CD):
   ```bash
   az keyvault secret show --vault-name <kv-name> --name api-key --query value -o tsv
   ```

3. **Get admin password** (for manual DB access):
   ```bash
   az keyvault secret show --vault-name <kv-name> --name pg-admin-password --query value -o tsv
   ```

## Cost Estimate

| Resource | Monthly Cost (approx) |
|----------|----------------------|
| PostgreSQL B1ms | ~€12 |
| 4× Container Apps (Consumption) | ~€0–5 (pay per request) |
| Key Vault | ~€1 |
| **Total** | **~€15–20** |

## Known Limitations

- Terraform provider enforces `/21` subnet (Azure accepts `/27`): [GitHub #24596](https://github.com/hashicorp/terraform-provider-azurerm/issues/24596)
- `az postgres flexible-server execute` requires `rdbms-connect` extension
- PostgreSQL region restrictions may apply (check with `az postgres flexible-server list-skus`)
- The Container Apps Environment `maximum_count` must be `0` for Consumption profiles (API returns `0` regardless of config)

## File Structure

```
terraform/azure/
├── main.tf                 # Resource group, VNet, CAE
├── providers.tf            # azurerm, azuread, azapi
├── versions.tf             # Provider versions
├── variables.tf            # All input variables
├── postgresql.tf           # PG server, AAD admin, firewall, database
├── keyvault.tf             # Key Vault + secrets
├── container-apps.tf       # Managed identity + 4 container apps
├── easy-auth.tf            # Entra ID app registration + auth config
├── nginx-config.tf         # Gateway nginx template (Azure DNS resolver)
├── outputs.tf              # All outputs
├── terraform.tfvars.example # Example variables
└── README.md               # This file
```
