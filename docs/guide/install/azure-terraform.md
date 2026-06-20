# Deploy to Azure (Terraform)

The `terraform/azure` module provisions a production-ready Azure Container Apps stack end-to-end. The full Terraform reference is in [`terraform/azure/README.md`](https://github.com/kostiantyn-matsebora/deployment-dashboard/blob/main/terraform/azure/README.md).

For an overview of deployment shapes and shared prerequisites, see the [Install & deploy landing](./index.md).

## Topology

| Component | Azure resource | Ingress |
|---|---|---|
| Gateway | Container App (nginx) | External — public HTTPS URL |
| Frontend | Container App (Angular/nginx) | Internal |
| API | Container App (.NET 10) | Internal |
| Fetcher | Container App (GitHub poller) | None — outbound only |
| PostgreSQL | Flexible Server B1ms | VNet — managed-identity AAD auth |
| Key Vault | Standard | API key · GitHub token · PG admin password |

## Prerequisites

- Azure CLI authenticated (`az login`)
- Terraform >= 1.5

## Deploy

```bash
cd terraform/azure
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars — fill in subscription_id (required) and your values
terraform init
terraform plan
terraform apply
```

Key variables:

| Variable | Notes |
|---|---|
| `subscription_id` | **Required** — no default (azurerm v4) |
| `dashboard_version` | Pin to a release tag, e.g. `0.17.0` |
| `github_repos` | Comma-separated `owner/repo` list; leave empty to disable the Fetcher |
| `allowed_ip_ranges` | CIDR list to restrict gateway access; default `[]` = fully public |
| `enable_easy_auth` | `true` to require Entra ID login on the gateway |

## Post-deploy steps

1. **Get the API key** (for push-mode CI/CD):

    ```bash
    az keyvault secret show --vault-name <kv-name> --name api-key --query value -o tsv
    ```

2. **Set the GitHub token** (required if using the Fetcher):

    ```bash
    az keyvault secret set --vault-name <kv-name> --name github-token --value <pat>
    ```

    !!! warning "Anonymous mode is not supported"
        The Fetcher unconditionally sends `Authorization: Bearer <token>` — a missing or placeholder token 401s immediately. Anonymous GitHub access is also impractical at 60 req/hr. The token must be a real read-only PAT (same scopes as the Docker Compose [`-pull` profiles](./docker-compose.md#2-configure--run)).

## Cost

~€15–20 / month: PostgreSQL B1ms (~€12) + 4× Container Apps Consumption (~€0–5) + Key Vault (~€1).

## Networking & security

- The gateway is **fully public by default** (`allowed_ip_ranges = []`). Set `allowed_ip_ranges` to lock it down; set `enable_easy_auth = true` to require Entra ID login.
- PostgreSQL uses managed-identity AAD auth — no static password in config.
- All secrets (API key, GitHub token, PG admin password) are stored in Key Vault and injected at runtime.
