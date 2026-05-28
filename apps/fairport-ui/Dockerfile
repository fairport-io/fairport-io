# Step 1: Build (native arch to avoid QEMU issues with esbuild)
FROM --platform=$BUILDPLATFORM node:22-slim AS base
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Step 2: Production (inherits target platform from docker build --platform)
FROM node:22-slim AS build
WORKDIR /app
COPY --from=base /app/dist ./dist
COPY --from=base /app/package*.json ./
COPY --from=base /app/node_modules ./node_modules
RUN touch db.yaml && mkdir -p pglite-data && chown -R node:node db.yaml pglite-data
ENV NODE_ENV=production
ENV PORT=8000
EXPOSE 8000
USER node
CMD ["node", "dist/server.js"]

# Step 3: Test (native arch for fast execution)
FROM --platform=$BUILDPLATFORM node:22-slim AS test
WORKDIR /app

# Node deps — cached unless package.json changes
COPY --from=base /app/node_modules ./node_modules

# Browser binary + system deps — cached unless @playwright/test version changes
RUN npx playwright install --with-deps chromium

# Source code — invalidates on every code change
COPY . .

# Tests — re-runs on code change only
# Unit tests cover all backend logic (auth, keys, providers, rate limiting, queue, encryption, RBAC)
# E2E tests (Playwright) require UI stability — run separately with: docker build --target e2e .
ARG CACHEBUST
RUN npx vitest run --reporter=verbose
RUN npx playwright test --reporter=list
