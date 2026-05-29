FROM nginxinc/nginx-unprivileged:stable-alpine

# curl — used by the Docker healthcheck (CMD-SHELL curl /health).
RUN apk add --no-cache curl

# Restrict envsubst to our two upstream vars so nginx's own
# $host / $uri / $scheme / $proxy_add_x_forwarded_for etc. are not wiped.
ENV NGINX_ENVSUBST_FILTER='^(FRONTEND_UPSTREAM|API_UPSTREAM)$'

COPY default.conf.template /etc/nginx/templates/default.conf.template
