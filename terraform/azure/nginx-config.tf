# -----------------------------------------------------------------------------
# Nginx config template override for the gateway container
#
# Both API and Frontend are internal — HTTP via upstream blocks, system DNS.
# Key differences from upstream:
#   - resolver 127.0.0.11 removed (not needed — no variable-based proxy_pass)
#   - Both services use upstream blocks (system DNS) for FQDN resolution
#   - HTTP only (internal ingress, allow_insecure = true)
#   - proxy_set_header Host set to target FQDN (Envoy routing requirement)
#   - X-Forwarded-For reset to $remote_addr (prevents header accumulation)
#
# NOTE: $${...} is Terraform's escape for ${...}. The actual secret content
# uses single $ for envsubst variables (${API_UPSTREAM}, ${FRONTEND_UPSTREAM}).
# $remote_addr and $scheme stay as single $ (nginx variables, not envsubst).
# -----------------------------------------------------------------------------

locals {
  gateway_nginx_template = <<-NGINX
    # Upstreams — resolved at startup via system DNS (not nginx resolver)
    upstream frontend { server $${FRONTEND_UPSTREAM}; }
    upstream api { server $${API_UPSTREAM}; }

    server {
      listen 8080;
      server_tokens off;
      client_max_body_size 256k;

      proxy_http_version 1.1;
      proxy_set_header X-Forwarded-For $remote_addr;
      proxy_set_header X-Forwarded-Proto $scheme;

      # --- Gateway liveness ---
      location = /health {
        return 200 "ok\n";
        access_log off;
        default_type text/plain;
      }

      # --- API SSE stream ---
      location = /api/events/stream {
        proxy_pass http://api;
        proxy_set_header Host              '$${API_UPSTREAM}';
        proxy_set_header X-Forwarded-For   $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection        '';
        proxy_buffering off;
        proxy_cache off;
        gzip off;
        proxy_read_timeout 3600s;
        chunked_transfer_encoding on;
      }

      # --- API: JSON read/write ---
      location /api/ {
        proxy_pass http://api;
        proxy_set_header Host              '$${API_UPSTREAM}';
        proxy_set_header X-Forwarded-For   $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
      }

      # --- Ops probes ---
      location = /healthz {
        proxy_pass http://api;
        proxy_set_header Host '$${API_UPSTREAM}';
      }
      location = /readyz {
        proxy_pass http://api;
        proxy_set_header Host '$${API_UPSTREAM}';
      }

      # --- API docs ---
      location = /scalar {
        proxy_pass http://api;
        proxy_set_header Host '$${API_UPSTREAM}';
      }
      location /scalar/ {
        proxy_pass http://api;
        proxy_set_header Host '$${API_UPSTREAM}';
      }
      location /openapi/ {
        proxy_pass http://api;
        proxy_set_header Host '$${API_UPSTREAM}';
      }

      # --- Frontend SPA ---
      location / {
        proxy_pass http://frontend;
        proxy_set_header Host              '$${FRONTEND_UPSTREAM}';
        proxy_set_header X-Forwarded-For   $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
      }
    }
  NGINX
}
