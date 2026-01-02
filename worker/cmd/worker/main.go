package main

import (
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"dorker/worker/internal/engine"
	"dorker/worker/internal/protocol"
	"dorker/worker/internal/proxy"
	"dorker/worker/internal/stealth"
	"dorker/worker/internal/worker"
)

var (
	Version   = "1.0.0"
	BuildTime = "unknown"
)

func main() {
	// Parse flags
	showVersion := flag.Bool("version", false, "Show version")
	standalone := flag.Bool("standalone", false, "Run in standalone mode")
	dorkFile := flag.String("dorks", "", "Path to dorks file (standalone mode)")
	proxyFile := flag.String("proxies", "", "Path to proxies file (standalone mode)")
	outputDir := flag.String("output", "./output", "Output directory (standalone mode)")
	workers := flag.Int("workers", 10, "Number of workers (standalone mode)")
	flag.Parse()

	if *showVersion {
		fmt.Printf("Dorker Worker v%s (built: %s)\n", Version, BuildTime)
		os.Exit(0)
	}

	// Check if running in IPC mode or standalone
	stat, _ := os.Stdin.Stat()
	isIPCMode := (stat.Mode()&os.ModeCharDevice) == 0 && !*standalone

	if isIPCMode {
		runIPCMode()
	} else {
		runStandaloneMode(*dorkFile, *proxyFile, *outputDir, *workers)
	}
}

func runIPCMode() {
	// Create protocol handler
	handler := protocol.NewHandler()

	// Worker instance (created on init)
	var w *worker.Worker
	var proxyPool *proxy.Pool

	// Handle init
	handler.OnInit(func(config *protocol.InitConfig) {
		// Create proxy pool
		poolConfig := proxy.DefaultPoolConfig()
		proxyPool = proxy.NewPool(poolConfig)

		// Load proxies from file if provided
		if config.ProxyFile != "" {
			added, errs := proxyPool.LoadFromFile(config.ProxyFile)
			handler.SendLog("info", fmt.Sprintf("Loaded %d proxies from file", added))
			for _, err := range errs {
				handler.SendLog("warn", fmt.Sprintf("Proxy load error: %v", err))
			}
		}

		// Load proxies from list if provided
		if len(config.Proxies) > 0 {
			parser := proxy.NewParser()
			for _, p := range config.Proxies {
				prx, err := parser.ParseLine(p)
				if err != nil {
					handler.SendLog("warn", fmt.Sprintf("Invalid proxy: %s", p))
					continue
				}
				if prx != nil {
					proxyPool.AddProxy(prx)
				}
			}
		}

		// Send proxy info
		stats := proxyPool.Stats()
		handler.SendProxyInfo(stats.Alive, stats.Dead, stats.Quarantined)

		// Create worker config
		workerConfig := worker.DefaultConfig()
		workerConfig.Workers = config.Workers
		workerConfig.RequestTimeout = config.Timeout
		workerConfig.BaseDelay = config.BaseDelay
		workerConfig.MinDelay = config.MinDelay
		workerConfig.MaxDelay = config.MaxDelay
		workerConfig.MaxRetries = config.MaxRetries
		workerConfig.ResultsPerPage = config.ResultsPerPage

		// Create worker
		w = worker.New(workerConfig, proxyPool)

		// Start result processor
		go processResults(handler, w)

		// Start worker
		w.Start()

		// Start proxy pool health check
		proxyPool.StartHealthCheck()

		handler.SendStatus("initialized", fmt.Sprintf("Worker initialized with %d workers", config.Workers))
	})

	// Handle task
	handler.OnTask(func(task *protocol.TaskData) {
		if w == nil {
			handler.SendError("not_initialized", "Worker not initialized")
			return
		}

		err := w.Submit(&worker.Task{
			ID:   task.ID,
			Dork: task.Dork,
			Page: task.Page,
		})

		if err != nil {
			handler.SendError("submit_failed", err.Error())
		}
	})

	// Handle pause
	handler.OnPause(func() {
		if w != nil {
			w.Stop()
		}
	})

	// Handle resume
	handler.OnResume(func() {
		if w != nil {
			w.Start()
		}
	})

	// Handle get stats
	handler.OnGetStats(func() {
		if w == nil || proxyPool == nil {
			handler.SendStats(&protocol.StatsData{})
			return
		}

		workerStats := w.Stats()
		proxyStats := proxyPool.Stats()

		// Calculate ETA
		var etaMs int64
		if workerStats.RequestsPerSec > 0 {
			remaining := workerStats.TasksTotal - workerStats.TasksCompleted - workerStats.TasksFailed
			etaMs = int64(float64(remaining) / workerStats.RequestsPerSec * 1000)
		}

		handler.SendStats(&protocol.StatsData{
			TasksTotal:     workerStats.TasksTotal,
			TasksCompleted: workerStats.TasksCompleted,
			TasksFailed:    workerStats.TasksFailed,
			TasksPending:   int64(w.TaskQueueLength()),
			URLsFound:      workerStats.URLsFound,
			CaptchaCount:   workerStats.CaptchaCount,
			BlockCount:     workerStats.BlockCount,
			ProxiesAlive:   proxyStats.Alive,
			ProxiesDead:    proxyStats.Dead,
			RequestsPerSec: workerStats.RequestsPerSec,
			ElapsedMs:      workerStats.TotalDuration.Milliseconds(),
			ETAMs:          etaMs,
		})
	})

	// Handle shutdown
	handler.OnShutdown(func() {
		if w != nil {
			w.Stop()
		}
		if proxyPool != nil {
			proxyPool.StopHealthCheck()
		}
	})

	// Handle OS signals
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		handler.SendStatus("interrupted", "Received interrupt signal")
		if w != nil {
			w.Stop()
		}
		os.Exit(0)
	}()

	// Start handler
	handler.Start()
}

func processResults(handler *protocol.Handler, w *worker.Worker) {
	for result := range w.Results() {
		// Convert URLs to string slice
		urls := make([]string, len(result.URLs))
		for i, u := range result.URLs {
			urls[i] = u.URL
		}

		handler.SendResult(&protocol.ResultData{
			TaskID:   result.TaskID,
			Dork:     result.Dork,
			URLs:     urls,
			Status:   string(result.Status),
			Error:    result.Error,
			ProxyID:  result.ProxyID,
			Duration: result.Duration.Milliseconds(),
		})

		// Send progress update every result
		stats := w.Stats()
		if stats.TasksTotal > 0 {
			percentage := float64(stats.TasksCompleted+stats.TasksFailed) / float64(stats.TasksTotal) * 100
			handler.SendProgress(&protocol.ProgressData{
				Current:    stats.TasksCompleted + stats.TasksFailed,
				Total:      stats.TasksTotal,
				Percentage: percentage,
			})
		}
	}
}

func runStandaloneMode(dorkFile, proxyFile, outputDir string, numWorkers int) {
	printBanner()

	if dorkFile == "" || proxyFile == "" {
		fmt.Println("Usage: dorker-worker --standalone --dorks <file> --proxies <file> [options]")
		fmt.Println()
		fmt.Println("Options:")
		fmt.Println("  --dorks     Path to dorks file (required)")
		fmt.Println("  --proxies   Path to proxies file (required)")
		fmt.Println("  --output    Output directory (default: ./output)")
		fmt.Println("  --workers   Number of workers (default: 10)")
		fmt.Println("  --version   Show version")
		fmt.Println()
		fmt.Println("Example:")
		fmt.Println("  dorker-worker --standalone --dorks dorks.txt --proxies proxies.txt --workers 20")
		fmt.Println()
		os.Exit(1)
	}

	// Create proxy pool
	fmt.Println("Loading proxies...")
	poolConfig := proxy.DefaultPoolConfig()
	proxyPool := proxy.NewPool(poolConfig)

	added, errs := proxyPool.LoadFromFile(proxyFile)
	fmt.Printf("✓ Loaded %d proxies\n", added)
	if len(errs) > 0 {
		fmt.Printf("⚠ %d proxy errors\n", len(errs))
	}

	if added == 0 {
		fmt.Println("✗ No valid proxies found")
		os.Exit(1)
	}

	// Load dorks
	fmt.Println("Loading dorks...")
	dorks, err := loadDorks(dorkFile)
	if err != nil {
		fmt.Printf("✗ Failed to load dorks: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("✓ Loaded %d dorks\n", len(dorks))

	// Create output directory
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		fmt.Printf("✗ Failed to create output directory: %v\n", err)
		os.Exit(1)
	}

	// Create worker
	workerConfig := worker.DefaultConfig()
	workerConfig.Workers = numWorkers
	w := worker.New(workerConfig, proxyPool)

	// Start worker
	fmt.Println()
	fmt.Printf("Starting %d workers...\n", numWorkers)
	w.Start()
	proxyPool.StartHealthCheck()

	// Create output file
	outputFile, err := os.Create(fmt.Sprintf("%s/results_%d.txt", outputDir, time.Now().Unix()))
	if err != nil {
		fmt.Printf("✗ Failed to create output file: %v\n", err)
		os.Exit(1)
	}
	defer outputFile.Close()

	// Process results in background
	done := make(chan struct{})
	var urlCount int64
	go func() {
		for result := range w.Results() {
			for _, u := range result.URLs {
				outputFile.WriteString(u.URL + "\n")
				urlCount++
			}
		}
		close(done)
	}()

	// Submit dorks
	fmt.Println("Processing dorks...")
	fmt.Println()

	for i, dork := range dorks {
		w.Submit(&worker.Task{
			ID:   fmt.Sprintf("task_%d", i),
			Dork: dork,
		})
	}

	// Wait for completion
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	for {
		select {
		case <-sigCh:
			fmt.Println("\n\nInterrupted. Shutting down...")
			w.Stop()
			proxyPool.StopHealthCheck()
			<-done
			printFinalStats(w, urlCount, outputDir)
			os.Exit(0)

		case <-ticker.C:
			stats := w.Stats()
			proxyStats := proxyPool.Stats()

			completed := stats.TasksCompleted + stats.TasksFailed
			total := stats.TasksTotal
			percentage := float64(completed) / float64(total) * 100

			fmt.Printf("\r[%.1f%%] %d/%d dorks | %d URLs | %.1f req/s | Proxies: %d alive",
				percentage, completed, total, urlCount, stats.RequestsPerSec, proxyStats.Alive)

			if completed >= total {
				fmt.Println()
				w.Stop()
				proxyPool.StopHealthCheck()
				<-done
				printFinalStats(w, urlCount, outputDir)
				return
			}
		}
	}
}

func loadDorks(filepath string) ([]string, error) {
	file, err := os.Open(filepath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var dorks []string
	var buf [4096]byte
	var line []byte

	for {
		n, err := file.Read(buf[:])
		if n == 0 {
			if len(line) > 0 {
				dorks = append(dorks, string(line))
			}
			break
		}

		for i := 0; i < n; i++ {
			if buf[i] == '\n' {
				if len(line) > 0 && line[0] != '#' {
					dorks = append(dorks, string(line))
				}
				line = line[:0]
			} else if buf[i] != '\r' {
				line = append(line, buf[i])
			}
		}

		if err != nil {
			break
		}
	}

	return dorks, nil
}

func printBanner() {
	fmt.Println("╔═══════════════════════════════════════════════════════════════════╗")
	fmt.Println("║     ██████╗  ██████╗ ██████╗ ██╗  ██╗███████╗██████╗              ║")
	fmt.Println("║     ██╔══██╗██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝██╔══██╗             ║")
	fmt.Println("║     ██║  ██║██║   ██║██████╔╝█████╔╝ █████╗  ██████╔╝             ║")
	fmt.Println("║     ██║  ██║██║   ██║██╔══██╗██╔═██╗ ██╔══╝  ██╔══██╗             ║")
	fmt.Println("║     ██████╔╝╚██████╔╝██║  ██║██║  ██╗███████╗██║  ██║             ║")
	fmt.Println("║     ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝             ║")
	fmt.Println("║                                                                   ║")
	fmt.Printf("║                  Google Dork Parser v%-6s                       ║\n", Version)
	fmt.Println("║                       Worker Engine                               ║")
	fmt.Println("║                                                                   ║")
	fmt.Println("╚═══════════════════════════════════════════════════════════════════╝")
	fmt.Println()
}

func printFinalStats(w *worker.Worker, urlCount int64, outputDir string) {
	stats := w.Stats()

	fmt.Println()
	fmt.Println("═══════════════════════════════════════════════════════════════════")
	fmt.Println("                           COMPLETE")
	fmt.Println("═══════════════════════════════════════════════════════════════════")
	fmt.Println()
	fmt.Printf("  Total Dorks:      %d\n", stats.TasksTotal)
	fmt.Printf("  Completed:        %d\n", stats.TasksCompleted)
	fmt.Printf("  Failed:           %d\n", stats.TasksFailed)
	fmt.Printf("  URLs Found:       %d\n", urlCount)
	fmt.Printf("  CAPTCHAs:         %d\n", stats.CaptchaCount)
	fmt.Printf("  Blocks:           %d\n", stats.BlockCount)
	fmt.Printf("  Duration:         %s\n", stats.TotalDuration.Round(time.Second))
	fmt.Printf("  Avg Speed:        %.1f req/s\n", stats.RequestsPerSec)
	fmt.Println()
	fmt.Printf("  Results saved to: %s/\n", outputDir)
	fmt.Println()
}

// Blank imports to ensure packages are included
var (
	_ = engine.NewGoogle
	_ = stealth.NewManager
)
