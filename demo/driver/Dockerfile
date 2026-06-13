# Build context: demo/
# Stage 1: compile TypeScript
FROM node:lts-alpine AS builder

WORKDIR /app
COPY driver/package*.json ./
RUN npm ci
COPY driver/ .
RUN npm run build

# Stage 2: runtime — scenario data baked in so image is self-contained
FROM node:lts-alpine

# Patch OS packages to the latest in the pinned Alpine minor so the published
# image isn't gated on the base image catching up to Alpine's security repo
# (the Trivy CI gate fails on fixed CRITICAL/HIGH OS CVEs — e.g. CVE-2026-45447).
RUN apk upgrade --no-cache

WORKDIR /app
COPY driver/package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
# Bake default scenario data; override SCENARIOS_DIR at runtime if needed
COPY data/ /app/data/

ENV PORT=3001
ENV WRITE_API_URL=http://localhost:3000
ENV API_KEY=dev-secret
ENV SCENARIOS_DIR=/app/data
ENV EMIT_DELAY_MS=0

EXPOSE 3001
CMD ["node", "dist/main"]
