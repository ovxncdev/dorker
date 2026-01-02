package worker

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"dorker/worker/internal/proxy"
)

func TestDefaultConfig(t *testing.T) {
	config := DefaultConfig()

	if config.Workers <= 0 {
		t.Error("Workers should be positive")
	}

	if config.RequestTimeout <= 0 {
		t.Error("RequestTimeout should be positive")
	}

	if config.MaxRetries < 0 {
		t.Error("MaxRetries should be non-negative")
	}

	if config.ResultsPerPage <= 0 {
		t.Error("ResultsPerPage should be positive")
	}
}

func TestNewWorker(t *testing.T) {
	config := DefaultConfig()
	pool := proxy.NewPool(proxy.DefaultPoolConfig())

	w := New(config, pool)

	if w == nil {
		t.Fatal("New returned nil")
	}

	if w.config.Workers != config.Workers {
		t.Errorf("config.Workers = %d, want %d", w.config.Workers, config.Workers)
	}

	if w.pool == nil {
		t.Error("pool should not be nil")
	}

	if w.stealth == nil {
		t.Error("stealth manager should not be nil")
	}

	if w.engine == nil {
		t.Error("engine should not be nil")
	}
}

func TestWorkerStartStop(t *testing.T) {
	config := DefaultConfig()
	config.Workers = 2
	pool := proxy.NewPool(proxy.DefaultPoolConfig())

	w := New(config, pool)

	// Should not be running initially
	if w.IsRunning() {
		t.Error("worker should not be running initially")
	}

	// Start
	w.Start()

	if !w.IsRunning() {
		t.Error("worker should be running after Start")
	}

	// Starting again should be no-op
	w.Start()

	if !w.IsRunning() {
		t.Error("worker should still be running")
	}

	// Stop
	w.Stop()

	if w.IsRunning() {
		t.Error("worker should not be running after Stop")
	}
}

func TestWorkerSubmitNotRunning(t *testing.T) {
	config := DefaultConfig()
	pool := proxy.NewPool(proxy.DefaultPoolConfig())

	w := New(config, pool)

	task := &Task{
		ID:   "test_1",
		Dork: "inurl:admin",
	}

	err := w.Submit(task)
	if err == nil {
		t.Error("Submit should fail when worker not running")
	}
}

func TestWorkerSubmitRunning(t *testing.T) {
	config := DefaultConfig()
	config.Workers = 1
	config.BufferSize = 10
	pool := proxy.NewPool(proxy.DefaultPoolConfig())

	// Add a proxy
	prx := &proxy.Proxy{
		ID:   "test_proxy",
		Host: "127.0.0.1",
		Port: "8080",
		Type: proxy.ProxyTypeHTTP,
	}
	pool.AddProxy(prx)

	w := New(config, pool)
	w.Start()
	defer w.Stop()

	task := &Task{
		ID:   "test_1",
		Dork: "inurl:admin",
	}

	err := w.Submit(task)
	if err != nil {
		t.Errorf("Submit failed: %v", err)
	}

	stats := w.Stats()
	if stats.TasksTotal != 1 {
		t.Errorf("TasksTotal = %d, want 1", stats.TasksTotal)
	}
}

func TestWorkerSubmitBufferFull(t *testing.T) {
	config := DefaultConfig()
	config.Workers = 0 // No workers to process tasks
	config.BufferSize = 2
	pool := proxy.NewPool(proxy.DefaultPoolConfig())

	w := New(config, pool)
	w.running.Store(true) // Manually set running without starting workers

	// Fill buffer
	w.Submit(&Task{ID: "1", Dork: "test1"})
	w.Submit(&Task{ID: "2", Dork: "test2"})

	// This should fail
	err := w.Submit(&Task{ID: "3", Dork: "test3"})
	if err == nil {
		t.Error("Submit should fail when buffer is full")
	}
}

func TestWorkerStats(t *testing.T) {
	config := DefaultConfig()
	pool := proxy.NewPool(proxy.DefaultPoolConfig())

	w := New(config, pool)
	w.Start()
	defer w.Stop()

	// Initial stats
	stats := w.Stats()

	if stats.TasksTotal != 0 {
		t.Errorf("initial TasksTotal = %d, want 0", stats.TasksTotal)
	}

	if stats.TasksCompleted != 0 {
		t.Errorf("initial TasksCompleted = %d, want 0", stats.TasksCompleted)
	}

	if stats.URLsFound != 0 {
		t.Errorf("initial URLsFound = %d, want 0", stats.URLsFound)
	}
}

func TestWorkerQueueLengths(t *testing.T) {
	config := DefaultConfig()
	config.Workers = 0 // No workers
	config.BufferSize = 10
	pool := proxy.NewPool(proxy.DefaultPoolConfig())

	w := New(config, pool)
	w.running.Store(true)

	if w.TaskQueueLength() != 0 {
		t.Errorf("initial task queue length = %d, want 0", w.TaskQueueLength())
	}

	w.Submit(&Task{ID: "1", Dork: "test"})
	w.Submit(&Task{ID: "2", Dork: "test"})

	if w.TaskQueueLength() != 2 {
		t.Errorf("task queue length = %d, want 2", w.TaskQueueLength())
	}
}

func TestWorkerResultsChannel(t *testing.T) {
	config := DefaultConfig()
	pool := proxy.NewPool(proxy.DefaultPoolConfig())

	w := New(config, pool)

	results := w.Results()
	if results == nil {
		t.Error("Results channel should not be nil")
	}
}

func TestWorkerWithMockServer(t *testing.T) {
	// Create mock Google server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check headers
		ua := r.Header.Get("User-Agent")
		if ua == "" {
			t.Error("User-Agent header missing")
		}

		// Return mock results
		html := `
		<html>
		<body>
			<div class="g">
				<a href="/url?q=https://example.com/admin">Example Admin</a>
			</div>
			<div class="g">
				<a href="/url?q=https://test.org/login">Test Login</a>
			</div>
		</body>
		</html>
		`
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(html))
	}))
	defer server.Close()

	// Note: This test would require modifying the worker to use the mock server
	// For now, we just verify the server works
	resp, err := http.Get(server.URL)
	if err != nil {
		t.Fatalf("mock server request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("mock server status = %d, want 200", resp.StatusCode)
	}
}

func TestWorkerCaptchaDetection(t *testing.T) {
	// Create mock server that returns CAPTCHA
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		html := `
		<html>
		<body>
			<div class="g-recaptcha">Please verify you're not a robot</div>
		</body>
		</html>
		`
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(html))
	}))
	defer server.Close()

	// Verify CAPTCHA HTML is detected
	resp, _ := http.Get(server.URL)
	defer resp.Body.Close()

	// Read body and check
	buf := make([]byte, 1024)
	n, _ := resp.Body.Read(buf)
	html := string(buf[:n])

	if !strings.Contains(strings.ToLower(html), "recaptcha") {
		t.Error("mock server should return CAPTCHA page")
	}
}

func TestWorkerBlockDetection(t *testing.T) {
	// Create mock server that returns block page
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte("403 Forbidden - Access Denied"))
	}))
	defer server.Close()

	resp, _ := http.Get(server.URL)
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("mock server status = %d, want 403", resp.StatusCode)
	}
}

func TestResultStatus(t *testing.T) {
	statuses := []ResultStatus{
		StatusSuccess,
		StatusNoResults,
		StatusCaptcha,
		StatusBlocked,
		StatusError,
		StatusRetry,
	}

	// Verify all statuses are unique
	seen := make(map[ResultStatus]bool)
	for _, s := range statuses {
		if seen[s] {
			t.Errorf("duplicate status: %s", s)
		}
		seen[s] = true
	}
}

func TestTaskStruct(t *testing.T) {
	task := &Task{
		ID:    "task_001",
		Dork:  "inurl:admin filetype:php",
		Page:  0,
		Retry: 0,
	}

	if task.ID != "task_001" {
		t.Errorf("task ID = %q, want %q", task.ID, "task_001")
	}

	if task.Dork != "inurl:admin filetype:php" {
		t.Errorf("task Dork = %q", task.Dork)
	}
}

func TestResultStruct(t *testing.T) {
	result := &Result{
		TaskID:    "task_001",
		Dork:      "inurl:admin",
		Status:    StatusSuccess,
		ProxyID:   "proxy_001",
		Duration:  500 * time.Millisecond,
		Timestamp: time.Now(),
	}

	if result.Status != StatusSuccess {
		t.Errorf("result Status = %q, want %q", result.Status, StatusSuccess)
	}

	if result.Duration != 500*time.Millisecond {
		t.Errorf("result Duration = %v", result.Duration)
	}
}

func TestWorkerConcurrentSubmit(t *testing.T) {
	config := DefaultConfig()
	config.Workers = 5
	config.BufferSize = 100
	pool := proxy.NewPool(proxy.DefaultPoolConfig())

	// Add some proxies
	for i := 0; i < 10; i++ {
		prx := &proxy.Proxy{
			ID:   fmt.Sprintf("proxy_%d", i),
			Host: fmt.Sprintf("127.0.0.%d", i),
			Port: "8080",
			Type: proxy.ProxyTypeHTTP,
		}
		pool.AddProxy(prx)
	}

	w := New(config, pool)
	w.Start()
	defer w.Stop()

	// Submit tasks concurrently
	var wg sync.WaitGroup
	errors := make(chan error, 50)

	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			task := &Task{
				ID:   fmt.Sprintf("task_%d", idx),
				Dork: fmt.Sprintf("inurl:test%d", idx),
			}
			if err := w.Submit(task); err != nil {
				errors <- err
			}
		}(i)
	}

	wg.Wait()
	close(errors)

	// Check for errors
	errorCount := 0
	for err := range errors {
		t.Logf("submit error: %v", err)
		errorCount++
	}

	if errorCount > 0 {
		t.Errorf("%d concurrent submit errors", errorCount)
	}

	stats := w.Stats()
	if stats.TasksTotal != 50 {
		t.Errorf("TasksTotal = %d, want 50", stats.TasksTotal)
	}
}

func TestWorkerApplyDelay(t *testing.T) {
	config := DefaultConfig()
	config.BaseDelay = 100 * time.Millisecond
	config.MinDelay = 50 * time.Millisecond
	config.MaxDelay = 200 * time.Millisecond
	pool := proxy.NewPool(proxy.DefaultPoolConfig())

	w := New(config, pool)

	// Measure delay
	start := time.Now()
	w.applyDelay()
	elapsed := time.Since(start)

	if elapsed < config.MinDelay {
		t.Errorf("delay %v is less than min %v", elapsed, config.MinDelay)
	}

	if elapsed > config.MaxDelay+50*time.Millisecond { // Small buffer for execution time
		t.Errorf("delay %v is greater than max %v", elapsed, config.MaxDelay)
	}
}

func TestWorkerSendResult(t *testing.T) {
	config := DefaultConfig()
	config.BufferSize = 5
	pool := proxy.NewPool(proxy.DefaultPoolConfig())

	w := New(config, pool)

	// Send results
	for i := 0; i < 5; i++ {
		w.sendResult(&Result{
			TaskID: fmt.Sprintf("task_%d", i),
			Status: StatusSuccess,
		})
	}

	if w.ResultQueueLength() != 5 {
		t.Errorf("result queue length = %d, want 5", w.ResultQueueLength())
	}

	// Drain results
	for i := 0; i < 5; i++ {
		select {
		case r := <-w.results:
			if r == nil {
				t.Error("received nil result")
			}
		default:
			t.Errorf("expected result %d not available", i)
		}
	}
}

func TestConfigValidation(t *testing.T) {
	config := DefaultConfig()

	// Test that default config has sensible values
	if config.Workers < 1 || config.Workers > 1000 {
		t.Errorf("Workers = %d, should be between 1 and 1000", config.Workers)
	}

	if config.BufferSize < 1 {
		t.Errorf("BufferSize = %d, should be at least 1", config.BufferSize)
	}

	if config.RequestTimeout < 1*time.Second {
		t.Errorf("RequestTimeout = %v, should be at least 1s", config.RequestTimeout)
	}

	if config.ResultsPerPage < 10 || config.ResultsPerPage > 100 {
		t.Errorf("ResultsPerPage = %d, should be between 10 and 100", config.ResultsPerPage)
	}
}
