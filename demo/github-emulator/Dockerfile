# Build context: demo/
# Stage 1: compile TypeScript
FROM node:lts-alpine AS builder

WORKDIR /app
COPY github-emulator/package*.json ./
RUN npm ci
COPY github-emulator/ .
RUN npm run build

# Stage 2: runtime — fixture data baked in so image is self-contained
FROM node:lts-alpine

# Patch OS packages to the latest in the pinned Alpine minor so the published
# image isn't gated on the base image catching up to Alpine's security repo
# (the Trivy CI gate fails on fixed CRITICAL/HIGH OS CVEs — e.g. CVE-2026-45447).
RUN apk upgrade --no-cache

WORKDIR /app
COPY github-emulator/package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
# Bake default fixture data; override SCENARIOS_DIR at runtime if needed
COPY data/ /app/data/

ENV PORT=3100
ENV GITHUB_SIM_RATE_LIMIT=5000
ENV SEED_ON_STARTUP=true
ENV SCENARIOS_DIR=/app/data
ENV EMIT_INTERVAL_MS=8000

EXPOSE 3100
CMD ["node", "dist/main"]
