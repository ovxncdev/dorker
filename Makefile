#═══════════════════════════════════════════════════════════════════════════════
# Dorker - Google Dork Parser
# Makefile for building Go worker and TypeScript CLI
#═══════════════════════════════════════════════════════════════════════════════

.PHONY: all build build-worker build-cli clean test test-worker test-cli dev install release help

# Variables
WORKER_DIR := worker
CLI_DIR := cli
BIN_DIR := bin
WORKER_BIN := $(BIN_DIR)/worker
VERSION := 1.0.0
BUILD_TIME := $(shell date -u '+%Y-%m-%d_%H:%M:%S')
LDFLAGS := -ldflags "-X main.Version=$(VERSION) -X main.BuildTime=$(BUILD_TIME)"

# Default target
all: build

#───────────────────────────────────────────────────────────────────────────────
# Build targets
#───────────────────────────────────────────────────────────────────────────────

build: build-worker build-cli ## Build both worker and CLI
	@echo ""
	@echo "✓ Build complete!"
	@echo "  Worker: $(WORKER_BIN)"
	@echo "  CLI:    $(CLI_DIR)/dist/index.js"

build-worker: $(BIN_DIR) ## Build Go worker
	@echo "Building Go worker..."
	cd $(WORKER_DIR) && go build $(LDFLAGS) -o ../$(WORKER_BIN) ./cmd/worker
	@echo "✓ Worker built: $(WORKER_BIN)"

build-cli: ## Build TypeScript CLI
	@echo "Building TypeScript CLI..."
	cd $(CLI_DIR) && npm install && npm run build
	@echo "✓ CLI built: $(CLI_DIR)/dist/"

$(BIN_DIR):
	mkdir -p $(BIN_DIR)

#───────────────────────────────────────────────────────────────────────────────
# Test targets
#───────────────────────────────────────────────────────────────────────────────

test: test-worker test-cli ## Run all tests
	@echo ""
	@echo "✓ All tests passed!"

test-worker: ## Run Go worker tests
	@echo "Running Go worker tests..."
	cd $(WORKER_DIR) && go test -v ./...

test-cli: ## Run TypeScript CLI tests
	@echo "Running TypeScript CLI tests..."
	cd $(CLI_DIR) && npm test

test-coverage: ## Run tests with coverage
	@echo "Running tests with coverage..."
	cd $(WORKER_DIR) && go test -cover -coverprofile=coverage.out ./...
	cd $(WORKER_DIR) && go tool cover -html=coverage.out -o coverage.html
	@echo "✓ Coverage report: $(WORKER_DIR)/coverage.html"

#───────────────────────────────────────────────────────────────────────────────
# Development targets
#───────────────────────────────────────────────────────────────────────────────

dev: build-worker ## Run CLI in development mode
	cd $(CLI_DIR) && npm run dev

dev-worker: ## Run worker in standalone mode
	cd $(WORKER_DIR) && go run ./cmd/worker --standalone --help

watch: ## Watch for changes and rebuild
	@echo "Watching for changes..."
	@while true; do \
		inotifywait -qr -e modify -e create -e delete $(WORKER_DIR)/internal $(WORKER_DIR)/cmd $(CLI_DIR)/src 2>/dev/null || sleep 2; \
		echo "Change detected, rebuilding..."; \
		$(MAKE) build; \
	done

#───────────────────────────────────────────────────────────────────────────────
# Installation targets
#───────────────────────────────────────────────────────────────────────────────

install: build ## Install dorker globally
	@echo "Installing dorker..."
	cp $(WORKER_BIN) /usr/local/bin/dorker-worker
	cd $(CLI_DIR) && npm link
	@echo "✓ Installed! Run 'dorker --help' to get started"

uninstall: ## Uninstall dorker
	@echo "Uninstalling dorker..."
	rm -f /usr/local/bin/dorker-worker
	cd $(CLI_DIR) && npm unlink
	@echo "✓ Uninstalled"

#───────────────────────────────────────────────────────────────────────────────
# Release targets
#───────────────────────────────────────────────────────────────────────────────

release: clean ## Build release binaries for all platforms
	@echo "Building release binaries..."
	mkdir -p $(BIN_DIR)/release

	# Linux AMD64
	@echo "  Building linux-amd64..."
	cd $(WORKER_DIR) && GOOS=linux GOARCH=amd64 go build $(LDFLAGS) -o ../$(BIN_DIR)/release/worker-linux-amd64 ./cmd/worker

	# Linux ARM64
	@echo "  Building linux-arm64..."
	cd $(WORKER_DIR) && GOOS=linux GOARCH=arm64 go build $(LDFLAGS) -o ../$(BIN_DIR)/release/worker-linux-arm64 ./cmd/worker

	# macOS AMD64
	@echo "  Building darwin-amd64..."
	cd $(WORKER_DIR) && GOOS=darwin GOARCH=amd64 go build $(LDFLAGS) -o ../$(BIN_DIR)/release/worker-darwin-amd64 ./cmd/worker

	# macOS ARM64 (Apple Silicon)
	@echo "  Building darwin-arm64..."
	cd $(WORKER_DIR) && GOOS=darwin GOARCH=arm64 go build $(LDFLAGS) -o ../$(BIN_DIR)/release/worker-darwin-arm64 ./cmd/worker

	# Windows AMD64
	@echo "  Building windows-amd64..."
	cd $(WORKER_DIR) && GOOS=windows GOARCH=amd64 go build $(LDFLAGS) -o ../$(BIN_DIR)/release/worker-windows-amd64.exe ./cmd/worker

	# Build CLI
	cd $(CLI_DIR) && npm install && npm run build

	@echo ""
	@echo "✓ Release binaries built in $(BIN_DIR)/release/"
	@ls -la $(BIN_DIR)/release/

#───────────────────────────────────────────────────────────────────────────────
# Utility targets
#───────────────────────────────────────────────────────────────────────────────

clean: ## Clean build artifacts
	@echo "Cleaning..."
	rm -rf $(BIN_DIR)
	rm -rf $(CLI_DIR)/dist
	rm -rf $(CLI_DIR)/node_modules
	rm -f $(WORKER_DIR)/coverage.out
	rm -f $(WORKER_DIR)/coverage.html
	@echo "✓ Clean"

lint: lint-worker lint-cli ## Run linters

lint-worker: ## Lint Go code
	@echo "Linting Go code..."
	cd $(WORKER_DIR) && go vet ./...
	@which golangci-lint > /dev/null && cd $(WORKER_DIR) && golangci-lint run || echo "golangci-lint not installed, skipping"

lint-cli: ## Lint TypeScript code
	@echo "Linting TypeScript code..."
	cd $(CLI_DIR) && npm run lint || true

fmt: ## Format code
	@echo "Formatting Go code..."
	cd $(WORKER_DIR) && go fmt ./...
	@echo "Formatting TypeScript code..."
	cd $(CLI_DIR) && npx prettier --write src/ || true
	@echo "✓ Formatted"

deps: ## Install dependencies
	@echo "Installing Go dependencies..."
	cd $(WORKER_DIR) && go mod download
	@echo "Installing Node dependencies..."
	cd $(CLI_DIR) && npm install
	@echo "✓ Dependencies installed"

update-deps: ## Update dependencies
	@echo "Updating Go dependencies..."
	cd $(WORKER_DIR) && go get -u ./... && go mod tidy
	@echo "Updating Node dependencies..."
	cd $(CLI_DIR) && npm update
	@echo "✓ Dependencies updated"

#───────────────────────────────────────────────────────────────────────────────
# Run targets
#───────────────────────────────────────────────────────────────────────────────

run: build ## Run with sample files
	@if [ ! -f input/sample-dorks.txt ] || [ ! -f input/sample-proxies.txt ]; then \
		echo "Error: Sample files not found. Create input/sample-dorks.txt and input/sample-proxies.txt"; \
		exit 1; \
	fi
	cd $(CLI_DIR) && node dist/index.js run -d ../input/sample-dorks.txt -p ../input/sample-proxies.txt

run-standalone: build-worker ## Run worker in standalone mode with sample files
	$(WORKER_BIN) --standalone --dorks input/sample-dorks.txt --proxies input/sample-proxies.txt

#───────────────────────────────────────────────────────────────────────────────
# Docker targets
#───────────────────────────────────────────────────────────────────────────────

docker-build: ## Build Docker image
	docker build -t dorker:$(VERSION) .

docker-run: ## Run in Docker container
	docker run -it --rm \
		-v $(PWD)/input:/app/input \
		-v $(PWD)/output:/app/output \
		dorker:$(VERSION) \
		run -d /app/input/dorks.txt -p /app/input/proxies.txt -o /app/output

#───────────────────────────────────────────────────────────────────────────────
# Help
#───────────────────────────────────────────────────────────────────────────────

help: ## Show this help
	@echo "Dorker - Google Dork Parser"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Examples:"
	@echo "  make build          Build everything"
	@echo "  make test           Run all tests"
	@echo "  make run            Run with sample files"
	@echo "  make release        Build release binaries"
