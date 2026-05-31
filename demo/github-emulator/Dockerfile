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
