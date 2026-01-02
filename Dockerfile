#═══════════════════════════════════════════════════════════════════════════════
# Dorker - Multi-stage Docker Build
#═══════════════════════════════════════════════════════════════════════════════

# Stage 1: Build Go Worker
FROM golang:1.22-alpine AS go-builder

WORKDIR /build

# Install build dependencies
RUN apk add --no-cache git ca-certificates

# Copy Go module files
COPY worker/go.mod worker/go.sum* ./worker/

# Download dependencies
WORKDIR /build/worker
RUN go mod download || true

# Copy source code
COPY worker/ ./

# Build worker binary
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-w -s -X main.Version=1.0.0" \
    -o /build/bin/worker \
    ./cmd/worker

#───────────────────────────────────────────────────────────────────────────────
# Stage 2: Build TypeScript CLI
FROM node:20-alpine AS node-builder

WORKDIR /build

# Copy package files
COPY cli/package*.json ./cli/

# Install dependencies
WORKDIR /build/cli
RUN npm ci --only=production=false

# Copy source code
COPY cli/ ./

# Build TypeScript
RUN npm run build

#───────────────────────────────────────────────────────────────────────────────
# Stage 3: Production Image
FROM node:20-alpine AS production

LABEL maintainer="Dorker"
LABEL description="High-performance Google Dork Parser"
LABEL version="1.0.0"

# Install runtime dependencies
RUN apk add --no-cache ca-certificates tini

# Create non-root user
RUN addgroup -g 1001 dorker && \
    adduser -u 1001 -G dorker -s /bin/sh -D dorker

WORKDIR /app

# Copy Go worker binary
COPY --from=go-builder /build/bin/worker /app/bin/worker

# Copy Node.js CLI
COPY --from=node-builder /build/cli/dist /app/cli/dist
COPY --from=node-builder /build/cli/node_modules /app/cli/node_modules
COPY --from=node-builder /build/cli/package.json /app/cli/package.json

# Create directories
RUN mkdir -p /app/input /app/output /app/logs && \
    chown -R dorker:dorker /app

# Set permissions
RUN chmod +x /app/bin/worker

# Switch to non-root user
USER dorker

# Environment variables
ENV NODE_ENV=production
ENV PATH="/app/bin:${PATH}"

# Volumes for input/output
VOLUME ["/app/input", "/app/output"]

# Working directory
WORKDIR /app

# Use tini as init system
ENTRYPOINT ["/sbin/tini", "--"]

# Default command
CMD ["node", "/app/cli/dist/index.js", "--help"]
