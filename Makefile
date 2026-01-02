.PHONY: all build build-worker build-cli clean dev test

# Default target
all: build

# Build everything
build: build-worker build-cli

# Build Go worker
build-worker:
	@echo "Building Go worker..."
	@cd worker && go build -ldflags="-s -w" -o ../bin/worker ./cmd/worker

# Build TypeScript CLI
build-cli:
	@echo "Building TypeScript CLI..."
	@cd cli && npm run build

# Development mode
dev:
	@echo "Starting development mode..."
	@cd worker && air &
	@cd cli && npm run dev

# Run tests
test: test-worker test-cli

test-worker:
	@cd worker && go test -v ./...

test-cli:
	@cd cli && npm test

# Clean build artifacts
clean:
	@rm -rf bin/
	@rm -rf cli/dist/
	@rm -rf worker/tmp/

# Install dependencies
deps:
	@echo "Installing Go dependencies..."
	@cd worker && go mod download
	@echo "Installing Node dependencies..."
	@cd cli && npm install

# Build for all platforms
release:
	@echo "Building for all platforms..."
	@cd worker && GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o ../bin/worker-linux-amd64 ./cmd/worker
	@cd worker && GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o ../bin/worker-darwin-amd64 ./cmd/worker
	@cd worker && GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o ../bin/worker-darwin-arm64 ./cmd/worker
	@cd worker && GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o ../bin/worker-windows-amd64.exe ./cmd/worker
