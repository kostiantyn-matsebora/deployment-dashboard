FROM nginxinc/nginx-unprivileged:stable-alpine

# This base image runs as the non-root `nginx` user (UID 101); apk needs root.
# Switch to root only for the package install, then drop back.
USER root
# curl — used by the Docker healthcheck (CMD-SHELL curl /health).
RUN apk add --no-cache curl
USER nginx

# Restrict envsubst to our two upstream vars so nginx's own
# $host / $uri / $scheme / $proxy_add_x_forwarded_for etc. are not wiped.
ENV NGINX_ENVSUBST_FILTER='^(FRONTEND_UPSTREAM|API_UPSTREAM)$'

COPY default.conf.template /etc/nginx/templates/default.conf.template
