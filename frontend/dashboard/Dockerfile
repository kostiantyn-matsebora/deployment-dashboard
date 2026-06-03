# ── Build stage ──────────────────────────────────────────────
FROM node:24-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci --prefer-offline

COPY . .
RUN npm run build -- --configuration production

# ── Serve stage — nginx:alpine ────────────────────────────────
# Spec: SAD §7 Dashboard Frontend — "nginx + Angular static"
FROM nginx:alpine AS serve

# Patch OS packages to the latest in the pinned Alpine minor so the published
# image isn't gated on the base image catching up to Alpine's security repo
# (the Trivy CI gate fails on fixed CRITICAL/HIGH OS CVEs — e.g. CVE-2026-6732).
RUN apk upgrade --no-cache

# Remove default nginx static content
RUN rm -rf /usr/share/nginx/html/*

# Copy built SPA
COPY --from=build /app/dist/dashboard/browser /usr/share/nginx/html

# SPA routing: all 404s → index.html (Angular router handles them)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
