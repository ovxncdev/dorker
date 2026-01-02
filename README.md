# Dorker

High-performance Google Dork parser with stealth capabilities.

## Architecture

- **Go Worker**: High-performance HTTP engine with CycleTLS for browser fingerprinting
- **TypeScript CLI**: Beautiful TUI interface with filtering and output management

## Features

- Process 400K+ dorks with 2K+ proxies
- JA3/HTTP2 fingerprint spoofing
- All proxy formats supported
- Bloom filter deduplication
- Real-time TUI dashboard
- Checkpoint/resume support

## Quick Start

```bash
# Build
make build

# Run
./dorker --dorks dorks.txt --proxies proxies.txt --output results/
```

## Requirements

- Go 1.22+
- Node.js 20+

## License

MIT
