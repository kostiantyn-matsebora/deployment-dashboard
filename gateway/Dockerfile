FROM nginxinc/nginx-unprivileged:stable-alpine

# This base image runs as the non-root `nginx` user (UID 101); apk needs root.
# Switch to root only for the package install, then drop back.
USER root
# curl — used by the Docker healthcheck (CMD-SHELL curl /health).
RUN apk add --no-cache curl
# Patch OS packages to the latest in the pinned Alpine minor so the published
# image isn't gated on the base image catching up to Alpine's security repo
# (the Trivy CI gate fails on fixed CRITICAL/HIGH OS CVEs — e.g. CVE-2026-45447).
RUN apk upgrade --no-cache
USER nginx

# Restrict envsubst to our vars so nginx's own $host / $uri / $scheme /
# $proxy_add_x_forwarded_for etc. are not wiped.
# DNS_RESOLVER: 127.0.0.11 = Docker embedded DNS (Compose default);
#               168.63.129.16 = Azure internal DNS (Container Apps).
ENV DNS_RESOLVER='127.0.0.11'
ENV NGINX_ENVSUBST_FILTER='^(FRONTEND_UPSTREAM|API_UPSTREAM|DEMO_DRIVER_UPSTREAM|DNS_RESOLVER)$'

COPY default.conf.template /etc/nginx/templates/default.conf.template
