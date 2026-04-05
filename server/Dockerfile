# Stage 1: builder — compile TypeScript to dist/
FROM node:20-slim AS builder
WORKDIR /app

# Copy manifests first to leverage Docker layer cache for npm ci
COPY package*.json ./
RUN npm ci

# Copy source and TypeScript config, then compile
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Stage 2: production — lean image with only compiled output
FROM node:20-slim
WORKDIR /app

# Copy compiled output and manifests from the builder stage
COPY --from=builder /app/dist ./dist
COPY package*.json ./

# Install production dependencies only (no devDependencies)
RUN npm ci --omit=dev

EXPOSE 3001

# curl is not present in node:20-slim by default — install it for the health check
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

HEALTHCHECK --interval=30s --timeout=5s \
  CMD curl -f http://localhost:3001/api/health || exit 1

# Drop to non-root user (built into the node:20-slim image)
USER node

CMD ["node", "dist/index.js"]
