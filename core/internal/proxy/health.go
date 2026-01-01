package proxy

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/net/proxy"
)

// HealthChecker checks proxy health
type HealthChecker struct {
	manager       *Manager
	testURL       string
	timeout       time.Duration
	workers       int
	slowThreshold time.Duration
	client        *http.Client
}

// HealthCheckResult holds result of a health check
type HealthCheckResult struct {
	ProxyID  string
	Status   Status
	Latency  time.Duration
	Error    error
}

// HealthCheckReport holds overall health check report
type HealthCheckReport struct {
	Total       int
	Alive       int
	Dead        int
	Slow        int
	StartTime   time.Time
	EndTime     time.Time
	Duration    time.Duration
	Results     []HealthCheckResult
}

// HealthCheckerConfig holds health checker configuration
type HealthCheckerConfig struct {
	TestURL       string
	Timeout       time.Duration
	Workers       int
	SlowThreshold time.Duration
}

// DefaultHealthCheckerConfig returns default configuration
func DefaultHealthCheckerConfig() HealthCheckerConfig {
	return HealthCheckerConfig{
		TestURL:       "https://www.google.com/robots.txt",
		Timeout:       10 * time.Second,
		Workers:       50,
		SlowThreshold: 5 * time.Second,
	}
}

// NewHealthChecker creates a new health checker
func NewHealthChecker(manager *Manager, config HealthCheckerConfig) *HealthChecker {
	return &HealthChecker{
		manager:       manager,
		testURL:       config.TestURL,
		timeout:       config.Timeout,
		workers:       config.Workers,
		slowThreshold: config.SlowThreshold,
	}
}

// CheckAll checks all proxies in the pool
func (hc *HealthChecker) CheckAll(ctx context.Context) *HealthCheckReport {
	proxies := hc.manager.GetAll()
	return hc.checkProxies(ctx, proxies)
}

// CheckAlive checks only alive proxies
func (hc *HealthChecker) CheckAlive(ctx context.Context) *HealthCheckReport {
	proxies := hc.manager.GetAlive()
	return hc.checkProxies(ctx, proxies)
}

// CheckOne checks a single proxy
func (hc *HealthChecker) CheckOne(ctx context.Context, proxyID string) *HealthCheckResult {
	p := hc.manager.Get(proxyID)
	if p == nil {
		return &HealthCheckResult{
			ProxyID: proxyID,
			Status:  StatusDead,
			Error:   fmt.Errorf("proxy not found"),
		}
	}

	return hc.checkProxy(ctx, p)
}

func (hc *HealthChecker) checkProxies(ctx context.Context, proxies []*Proxy) *HealthCheckReport {
	report := &HealthCheckReport{
		Total:     len(proxies),
		StartTime: time.Now(),
		Results:   make([]HealthCheckResult, 0, len(proxies)),
	}

	if len(proxies) == 0 {
		report.EndTime = time.Now()
		report.Duration = report.EndTime.Sub(report.StartTime)
		return report
	}

	// Create work channel
	work := make(chan *Proxy, len(proxies))
	results := make(chan HealthCheckResult, len(proxies))

	// Start workers
	var wg sync.WaitGroup
	for i := 0; i < hc.workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for p := range work {
				select {
				case <-ctx.Done():
					results <- HealthCheckResult{
						ProxyID: p.ID,
						Status:  StatusUnknown,
						Error:   ctx.Err(),
					}
				default:
					result := hc.checkProxy(ctx, p)
					results <- *result
				}
			}
		}()
	}

	// Send work
	go func() {
		for _, p := range proxies {
			work <- p
		}
		close(work)
	}()

	// Wait for workers and close results
	go func() {
		wg.Wait()
		close(results)
	}()

	// Collect results
	var alive, dead, slow int32
	for result := range results {
		report.Results = append(report.Results, result)

		// Update manager
		switch result.Status {
		case StatusAlive:
			atomic.AddInt32(&alive, 1)
			hc.manager.MarkAlive(result.ProxyID, result.Latency)
		case StatusSlow:
			atomic.AddInt32(&slow, 1)
			hc.manager.MarkSlow(result.ProxyID, result.Latency)
		case StatusDead:
			atomic.AddInt32(&dead, 1)
			hc.manager.MarkDead(result.ProxyID)
		}
	}

	report.Alive = int(alive)
	report.Dead = int(dead)
	report.Slow = int(slow)
	report.EndTime = time.Now()
	report.Duration = report.EndTime.Sub(report.StartTime)

	return report
}

func (hc *HealthChecker) checkProxy(ctx context.Context, p *Proxy) *HealthCheckResult {
	result := &HealthCheckResult{
		ProxyID: p.ID,
	}

	start := time.Now()

	// Create HTTP client with proxy
	client, err := hc.createClient(p)
	if err != nil {
		result.Status = StatusDead
		result.Error = err
		return result
	}

	// Create request
	req, err := http.NewRequestWithContext(ctx, "GET", hc.testURL, nil)
	if err != nil {
		result.Status = StatusDead
		result.Error = err
		return result
	}

	// Add headers
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")

	// Execute request
	resp, err := client.Do(req)
	if err != nil {
		result.Status = StatusDead
		result.Error = err
		result.Latency = time.Since(start)
		return result
	}
	defer resp.Body.Close()

	result.Latency = time.Since(start)

	// Check response
	if resp.StatusCode >= 200 && resp.StatusCode < 400 {
		if result.Latency > hc.slowThreshold {
			result.Status = StatusSlow
		} else {
			result.Status = StatusAlive
		}
	} else if resp.StatusCode == 407 {
		result.Status = StatusDead
		result.Error = fmt.Errorf("proxy authentication required")
	} else if resp.StatusCode == 403 || resp.StatusCode == 429 {
		result.Status = StatusDead
		result.Error = fmt.Errorf("proxy blocked or rate limited: %d", resp.StatusCode)
	} else {
		result.Status = StatusDead
		result.Error = fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	return result
}

func (hc *HealthChecker) createClient(p *Proxy) (*http.Client, error) {
	var transport *http.Transport

	switch p.Protocol {
	case ProtocolHTTP, ProtocolHTTPS:
		proxyURL, err := url.Parse(p.URL())
		if err != nil {
			return nil, err
		}

		transport = &http.Transport{
			Proxy: http.ProxyURL(proxyURL),
			DialContext: (&net.Dialer{
				Timeout:   hc.timeout,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: true,
			},
			MaxIdleConns:        100,
			IdleConnTimeout:     90 * time.Second,
			TLSHandshakeTimeout: 10 * time.Second,
		}

	case ProtocolSOCKS4, ProtocolSOCKS5:
		var auth *proxy.Auth
		if p.Username != "" {
			auth = &proxy.Auth{
				User:     p.Username,
				Password: p.Password,
			}
		}

		dialer, err := proxy.SOCKS5("tcp", fmt.Sprintf("%s:%s", p.Host, p.Port), auth, proxy.Direct)
		if err != nil {
			return nil, err
		}

		transport = &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				return dialer.Dial(network, addr)
			},
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: true,
			},
			MaxIdleConns:        100,
			IdleConnTimeout:     90 * time.Second,
			TLSHandshakeTimeout: 10 * time.Second,
		}

	default:
		return nil, fmt.Errorf("unsupported protocol: %s", p.Protocol)
	}

	return &http.Client{
		Transport: transport,
		Timeout:   hc.timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return fmt.Errorf("too many redirects")
			}
			return nil
		},
	}, nil
}

// StartPeriodicCheck starts periodic health checking
func (hc *HealthChecker) StartPeriodicCheck(ctx context.Context, interval time.Duration, callback func(*HealthCheckReport)) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			report := hc.CheckAll(ctx)
			if callback != nil {
				callback(report)
			}
		}
	}
}

// QuickCheck does a fast TCP connect check (no HTTP)
func (hc *HealthChecker) QuickCheck(ctx context.Context, p *Proxy) (bool, time.Duration) {
	start := time.Now()

	addr := fmt.Sprintf("%s:%s", p.Host, p.Port)
	
	dialer := &net.Dialer{
		Timeout: 5 * time.Second,
	}

	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return false, time.Since(start)
	}
	conn.Close()

	return true, time.Since(start)
}

// QuickCheckAll does fast TCP checks on all proxies
func (hc *HealthChecker) QuickCheckAll(ctx context.Context) *HealthCheckReport {
	proxies := hc.manager.GetAll()
	
	report := &HealthCheckReport{
		Total:     len(proxies),
		StartTime: time.Now(),
		Results:   make([]HealthCheckResult, 0, len(proxies)),
	}

	if len(proxies) == 0 {
		report.EndTime = time.Now()
		report.Duration = report.EndTime.Sub(report.StartTime)
		return report
	}

	work := make(chan *Proxy, len(proxies))
	results := make(chan HealthCheckResult, len(proxies))

	var wg sync.WaitGroup
	for i := 0; i < hc.workers*2; i++ { // More workers for quick checks
		wg.Add(1)
		go func() {
			defer wg.Done()
			for p := range work {
				alive, latency := hc.QuickCheck(ctx, p)
				status := StatusDead
				if alive {
					if latency > hc.slowThreshold {
						status = StatusSlow
					} else {
						status = StatusAlive
					}
				}
				results <- HealthCheckResult{
					ProxyID: p.ID,
					Status:  status,
					Latency: latency,
				}
			}
		}()
	}

	go func() {
		for _, p := range proxies {
			work <- p
		}
		close(work)
	}()

	go func() {
		wg.Wait()
		close(results)
	}()

	var alive, dead, slow int32
	for result := range results {
		report.Results = append(report.Results, result)
		switch result.Status {
		case StatusAlive:
			atomic.AddInt32(&alive, 1)
		case StatusSlow:
			atomic.AddInt32(&slow, 1)
		case StatusDead:
			atomic.AddInt32(&dead, 1)
		}
	}

	report.Alive = int(alive)
	report.Dead = int(dead)
	report.Slow = int(slow)
	report.EndTime = time.Now()
	report.Duration = report.EndTime.Sub(report.StartTime)

	return report
}

// Summary returns a string summary of the report
func (r *HealthCheckReport) Summary() string {
	return fmt.Sprintf(
		"Health Check: %d total, %d alive (%.1f%%), %d slow, %d dead in %s",
		r.Total,
		r.Alive,
		float64(r.Alive)/float64(r.Total)*100,
		r.Slow,
		r.Dead,
		r.Duration.Round(time.Millisecond),
	)
}
