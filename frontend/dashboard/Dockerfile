# ── Build stage ──────────────────────────────────────────────
FROM node:26-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci --prefer-offline

COPY . .
RUN npm run build -- --configuration production

# ── Serve stage — nginx:alpine ────────────────────────────────
# Spec: SAD §7 Dashboard Frontend — "nginx + Angular static"
FROM nginx:alpine AS serve

# Remove default nginx static content
RUN rm -rf /usr/share/nginx/html/*

# Copy built SPA
COPY --from=build /app/dist/dashboard/browser /usr/share/nginx/html

# SPA routing: all 404s → index.html (Angular router handles them)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
