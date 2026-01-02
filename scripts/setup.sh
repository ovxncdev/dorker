#!/bin/bash

#═══════════════════════════════════════════════════════════════════════════════
# Dorker Setup Script
# Run this script to set up the development environment
#═══════════════════════════════════════════════════════════════════════════════

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print banner
echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════════════╗"
echo "║     ██████╗  ██████╗ ██████╗ ██╗  ██╗███████╗██████╗              ║"
echo "║     ██╔══██╗██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝██╔══██╗             ║"
echo "║     ██║  ██║██║   ██║██████╔╝█████╔╝ █████╗  ██████╔╝             ║"
echo "║     ██║  ██║██║   ██║██╔══██╗██╔═██╗ ██╔══╝  ██╔══██╗             ║"
echo "║     ██████╔╝╚██████╔╝██║  ██║██║  ██╗███████╗██║  ██║             ║"
echo "║     ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝             ║"
echo "║                                                                   ║"
echo "║                         Setup Script                              ║"
echo "║                                                                   ║"
echo "╚═══════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Linux*)     OS=Linux;;
        Darwin*)    OS=Mac;;
        MINGW*|MSYS*|CYGWIN*)    OS=Windows;;
        *)          OS="Unknown"
    esac
    echo -e "${BLUE}Detected OS:${NC} $OS"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check Go installation
check_go() {
    echo -e "\n${YELLOW}[1/4] Checking Go installation...${NC}"
    
    if command_exists go; then
        GO_VERSION=$(go version | awk '{print $3}')
        echo -e "${GREEN}✔ Go is installed:${NC} $GO_VERSION"
    else
        echo -e "${RED}✖ Go is not installed${NC}"
        echo ""
        echo "Please install Go 1.22+ from https://go.dev/dl/"
        echo ""
        case $OS in
            Mac)
                echo "  brew install go"
                ;;
            Linux)
                echo "  sudo apt install golang-go"
                echo "  # or"
                echo "  sudo snap install go --classic"
                ;;
            Windows)
                echo "  Download from https://go.dev/dl/"
                ;;
        esac
        exit 1
    fi
}

# Check Node.js installation
check_node() {
    echo -e "\n${YELLOW}[2/4] Checking Node.js installation...${NC}"
    
    if command_exists node; then
        NODE_VERSION=$(node --version)
        echo -e "${GREEN}✔ Node.js is installed:${NC} $NODE_VERSION"
    else
        echo -e "${RED}✖ Node.js is not installed${NC}"
        echo ""
        echo "Please install Node.js 20+ from https://nodejs.org/"
        echo ""
        case $OS in
            Mac)
                echo "  brew install node"
                ;;
            Linux)
                echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
                echo "  sudo apt-get install -y nodejs"
                ;;
            Windows)
                echo "  Download from https://nodejs.org/"
                ;;
        esac
        exit 1
    fi
}

# Install Go dependencies and build
build_worker() {
    echo -e "\n${YELLOW}[3/4] Building Go worker...${NC}"
    
    cd worker
    
    echo "  Downloading dependencies..."
    go mod tidy
    
    echo "  Compiling..."
    mkdir -p ../bin
    go build -ldflags="-s -w" -o ../bin/worker ./cmd/worker
    
    cd ..
    
    echo -e "${GREEN}✔ Go worker built successfully${NC}"
    echo "  Binary: ./bin/worker"
}

# Install Node dependencies and build CLI
build_cli() {
    echo -e "\n${YELLOW}[4/4] Building TypeScript CLI...${NC}"
    
    if [ -d "cli" ]; then
        cd cli
        
        echo "  Installing dependencies..."
        npm install
        
        echo "  Compiling TypeScript..."
        npm run build
        
        cd ..
        
        echo -e "${GREEN}✔ TypeScript CLI built successfully${NC}"
    else
        echo -e "${YELLOW}⚠ CLI directory not found (will be created in next steps)${NC}"
    fi
}

# Create sample files
create_samples() {
    echo -e "\n${YELLOW}Creating sample files...${NC}"
    
    mkdir -p config
    mkdir -p input
    mkdir -p output
    
    # Sample dorks file
    if [ ! -f "input/sample-dorks.txt" ]; then
        cat > input/sample-dorks.txt << 'EOF'
inurl:admin
inurl:login
inurl:dashboard
filetype:pdf confidential
filetype:xls password
intitle:"index of"
inurl:config.php
inurl:wp-admin
site:edu filetype:pdf
inurl:phpmyadmin
EOF
        echo -e "${GREEN}✔ Created input/sample-dorks.txt${NC}"
    fi
    
    # Sample proxies file
    if [ ! -f "input/sample-proxies.txt" ]; then
        cat > input/sample-proxies.txt << 'EOF'
# Add your proxies here, one per line
# Supported formats:
# ip:port
# ip:port:user:pass
# user:pass@ip:port
# http://ip:port
# https://ip:port
# socks4://ip:port
# socks5://ip:port
# socks5://user:pass@ip:port

# Example (replace with real proxies):
# 192.168.1.1:8080
# 10.0.0.1:3128:username:password
# socks5://user:pass@192.168.1.1:1080
EOF
        echo -e "${GREEN}✔ Created input/sample-proxies.txt${NC}"
    fi
}

# Print completion message
print_complete() {
    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}                    Setup Complete!                                 ${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "Next steps:"
    echo ""
    echo "  1. Add your proxies to: input/sample-proxies.txt"
    echo "  2. Add your dorks to:   input/sample-dorks.txt"
    echo "  3. Run the tool:"
    echo ""
    echo "     ./bin/worker                    # Test worker standalone"
    echo "     npm start --prefix cli          # Run full CLI (coming soon)"
    echo ""
    echo "  For development:"
    echo ""
    echo "     make dev                        # Hot reload mode"
    echo "     make test                       # Run tests"
    echo ""
}

# Main
main() {
    detect_os
    check_go
    check_node
    build_worker
    build_cli
    create_samples
    print_complete
}

main "$@"
