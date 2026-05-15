# Dashboard Frontend container — Angular 20 SPA built with `ng build dashboard`
# and served by nginx:alpine as static files. This image holds zero upstream
# routing logic; the App Gateway (gateway/nginx.conf) handles all proxying.
#
# Build context: `frontend/` (the Angular workspace root). Compose:
#   build:
#     context: ../frontend
#     dockerfile: dashboard/Dockerfile
#
# Multi-stage:
#   1) node:22-alpine  — install deps, ng build dashboard, output to
#      /workspace/dist/dashboard/browser/.
#   2) nginx:alpine    — copy the browser bundle to /usr/share/nginx/html,
#      install the static-serving config, EXPOSE 80.
#
# Image name: deployment-dashboard/dashboard:dev

# ----- Build stage --------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /workspace

# Cache npm install separately from source. The `frontend/` workspace's
# package.json + lockfile are sufficient to restore the entire workspace.
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the Angular workspace and produce the production bundle.
# `npm run build` invokes `ng build dashboard`; the Angular application
# builder writes to `dist/dashboard/`, split into `browser/` (and optionally
# `server/`). We only ship `browser/` to nginx.
COPY . ./
RUN npm run build

# ----- Runtime stage ------------------------------------------------------
FROM nginx:alpine

# Drop the default nginx welcome site.
RUN rm -rf /usr/share/nginx/html/*

# Static-serving config: server block on :80, SPA history fallback to
# index.html, asset cache headers. NO upstream proxying — the App Gateway
# does that. The dashboard container is the simplest piece of the stack
# on purpose.
COPY dashboard/nginx.conf /etc/nginx/conf.d/default.conf

# Copy the Angular browser bundle into nginx's docroot.
COPY --from=build /workspace/dist/dashboard/browser/ /usr/share/nginx/html/

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1/index.html >/dev/null || exit 1
