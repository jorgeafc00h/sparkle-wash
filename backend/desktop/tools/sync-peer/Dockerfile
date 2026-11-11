# Headless Desktop device peer (tools/sync-peer) — see README.md.
# Build from the REPO ROOT so src/ resolves:
#   docker build -f tools/sync-peer/Dockerfile -t fs-sync-peer:local .
FROM node:22-slim

WORKDIR /app

# Dependencies first for layer caching.
COPY package*.json ./
RUN npm ci

COPY . .

# Fail the build if the harness stops working headless (store + capture plumbing).
RUN npx tsx tools/sync-peer/sync-peer.ts --selftest

ENTRYPOINT ["npx", "tsx", "tools/sync-peer/sync-peer.ts"]
