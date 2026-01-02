package worker

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"sync/atomic"
	"time"

	"dorker/worker/internal/engine"
	"dorker/worker/internal/proxy"
	"dorker/worker/internal/stealth"
)

// Config holds worker configuration
type Config struct {
	// Concurrency
	Workers    int `json:"workers"`
	BufferSize int `json:"buffer_size"`

	// Timing
	RequestTimeout time.Duration `json:"request_timeout"`
	BaseDelay      time.Duration `json:"base_delay"`
	MinDelay       time.Duration `json:"min_delay"`
	MaxDelay       time.Duration `json:"max_delay"`

	// Retry
	MaxRetries int           `json:"max_retries"`
	RetryDelay time.Duration `json:"retry_delay"`

	// Results
	ResultsPerPage int `json:"results_per_page"`
	MaxPages       int `json:"max_pages"`
}

// DefaultConfig returns sensible defaults
func DefaultConfig() Config {
	return Config{
		Workers:        10,
		BufferSize:     1000,
		RequestTimeout: 30 * time.Second,
		BaseDelay:      8 * time.Second,
		MinDelay:       3 * time.Second,
		MaxDelay:       15 * time.Second,
		MaxRetries:     3,
		RetryDelay:     5 * time.Second,
		ResultsPerPage: 100,
		MaxPages:       1,
	}
}

// Task represents a single dork query task
type Task struct {
	ID    string `json:"id"`
	Dork  string `json:"dork"`
	Page  int    `json:"page"`
	Retry int    `json:"retry"`
}

// Result represents the result of a task
type Result struct {
	TaskID    string                 `json:"task_id"`
	Dork      string                 `json:"dork"`
	URLs      []engine.SearchResult  `json:"urls"`
	Status    ResultStatus           `json:"status"`
	Error     string                 `json:"error,omitempty"`
	ProxyID   string                 `json:"proxy_id"`
	Duration  time.Duration          `json:"duration"`
	Timestamp time.Time              `json:"timestamp"`
}

// ResultStatus represents the status of a result
type ResultStatus string

const (
	StatusSuccess   ResultStatus = "success"
	StatusNoResults ResultStatus = "no_results"
	StatusCaptcha   ResultStatus = "captcha"
	StatusBlocked   ResultStatus = "blocked"
	StatusError     ResultStatus = "error"
	StatusRetry     ResultStatus = "retry"
)

// Stats holds worker statistics
type Stats struct {
	TasksTotal      int64         `json:"tasks_total"`
	TasksCompleted  int64         `json:"tasks_completed"`
	TasksFailed     int64         `json:"tasks_failed"`
	URLsFound       int64         `json:"urls_found"`
	CaptchaCount    int64         `json:"captcha_count"`
	BlockCount      int64         `json:"block_count"`
	TotalDuration   time.Duration `json:"total_duration"`
	RequestsPerSec  float64       `json:"requests_per_sec"`
}

// Worker handles the actual work
type Worker struct {
	config   Config
	pool     *proxy.Pool
	stealth  *stealth.Manager
	engine   engine.SearchEngine

	// Channels
	tasks    chan *Task
	results  chan *Result
	stopCh   chan struct{}

	// State
	running  atomic.Bool
	wg       sync.WaitGroup

	// Stats
	stats    Stats
	statsMu  sync.RWMutex
	startTime time.Time

	// HTTP client (will be replaced per-request with proxy)
	baseTransport *http.Transport
}

// New creates a new worker
func New(config Config, proxyPool *proxy.Pool) *Worker {
	return &Worker{
		config:  config,
		pool:    proxyPool,
		stealth: stealth.NewManager(),
		engine:  engine.NewGoogle(),
		tasks:   make(chan *Task, config.BufferSize),
		results: make(chan *Result, config.BufferSize),
		stopCh:  make(chan struct{}),
		baseTransport: &http.Transport{
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 10,
			IdleConnTimeout:     90 * time.Second,
		},
	}
}

// Start starts the worker pool
func (w *Worker) Start() {
	if w.running.Load() {
		return
	}

	w.running.Store(true)
	w.startTime = time.Now()

	// Start worker goroutines
	for i := 0; i < w.config.Workers; i++ {
		w.wg.Add(1)
		go w.worker(i)
	}
}

// Stop stops the worker pool
func (w *Worker) Stop() {
	if !w.running.Load() {
		return
	}

	w.running.Store(false)
	close(w.stopCh)
	w.wg.Wait()
	close(w.results)
}

// Submit submits a task to the worker pool
func (w *Worker) Submit(task *Task) error {
	if !w.running.Load() {
		return fmt.Errorf("worker not running")
	}

	select {
	case w.tasks <- task:
		atomic.AddInt64(&w.stats.TasksTotal, 1)
		return nil
	default:
		return fmt.Errorf("task buffer full")
	}
}

// Results returns the results channel
func (w *Worker) Results() <-chan *Result {
	return w.results
}

// Stats returns current statistics
func (w *Worker) Stats() Stats {
	w.statsMu.RLock()
	defer w.statsMu.RUnlock()

	stats := w.stats
	stats.TotalDuration = time.Since(w.startTime)

	if stats.TotalDuration.Seconds() > 0 {
		stats.RequestsPerSec = float64(stats.TasksCompleted) / stats.TotalDuration.Seconds()
	}

	return stats
}

// worker is the main worker goroutine
func (w *Worker) worker(id int) {
	defer w.wg.Done()

	for {
		select {
		case <-w.stopCh:
			return
		case task, ok := <-w.tasks:
			if !ok {
				return
			}
			w.processTask(id, task)
		}
	}
}

// processTask processes a single task
func (w *Worker) processTask(workerID int, task *Task) {
	startTime := time.Now()

	// Get a proxy
	prx, err := w.pool.Get()
	if err != nil {
		w.sendResult(&Result{
			TaskID:    task.ID,
			Dork:      task.Dork,
			Status:    StatusError,
			Error:     fmt.Sprintf("no proxy available: %v", err),
			Duration:  time.Since(startTime),
			Timestamp: time.Now(),
		})
		atomic.AddInt64(&w.stats.TasksFailed, 1)
		return
	}

	// Build search URL
	searchURL := w.engine.(*engine.Google).BuildSearchURL(task.Dork, task.Page, w.config.ResultsPerPage)

	// Make request
	html, err := w.makeRequest(searchURL, prx)
	duration := time.Since(startTime)

	if err != nil {
		w.pool.ReportFailure(prx.ID)
		w.handleRequestError(task, prx, err, duration)
		return
	}

	// Check for CAPTCHA
	if w.engine.(*engine.Google).DetectCaptcha(html) {
		w.pool.ReportCaptcha(prx.ID)
		atomic.AddInt64(&w.stats.CaptchaCount, 1)

		// Retry with different proxy
		if task.Retry < w.config.MaxRetries {
			task.Retry++
			w.retryTask(task)
			return
		}

		w.sendResult(&Result{
			TaskID:    task.ID,
			Dork:      task.Dork,
			Status:    StatusCaptcha,
			ProxyID:   prx.ID,
			Duration:  duration,
			Timestamp: time.Now(),
		})
		atomic.AddInt64(&w.stats.TasksFailed, 1)
		return
	}

	// Check for block
	if w.engine.(*engine.Google).DetectBlock(html) {
		w.pool.ReportBlock(prx.ID)
		atomic.AddInt64(&w.stats.BlockCount, 1)

		// Retry with different proxy
		if task.Retry < w.config.MaxRetries {
			task.Retry++
			w.retryTask(task)
			return
		}

		w.sendResult(&Result{
			TaskID:    task.ID,
			Dork:      task.Dork,
			Status:    StatusBlocked,
			ProxyID:   prx.ID,
			Duration:  duration,
			Timestamp: time.Now(),
		})
		atomic.AddInt64(&w.stats.TasksFailed, 1)
		return
	}

	// Parse results
	results := w.engine.(*engine.Google).ParseResults(html)

	// Report success
	w.pool.ReportSuccess(prx.ID, duration)

	// Check for no results
	if len(results) == 0 {
		if w.engine.(*engine.Google).DetectNoResults(html) {
			w.sendResult(&Result{
				TaskID:    task.ID,
				Dork:      task.Dork,
				Status:    StatusNoResults,
				URLs:      results,
				ProxyID:   prx.ID,
				Duration:  duration,
				Timestamp: time.Now(),
			})
		} else {
			w.sendResult(&Result{
				TaskID:    task.ID,
				Dork:      task.Dork,
				Status:    StatusSuccess,
				URLs:      results,
				ProxyID:   prx.ID,
				Duration:  duration,
				Timestamp: time.Now(),
			})
		}
		atomic.AddInt64(&w.stats.TasksCompleted, 1)
		return
	}

	// Success with results
	atomic.AddInt64(&w.stats.URLsFound, int64(len(results)))
	atomic.AddInt64(&w.stats.TasksCompleted, 1)

	w.sendResult(&Result{
		TaskID:    task.ID,
		Dork:      task.Dork,
		Status:    StatusSuccess,
		URLs:      results,
		ProxyID:   prx.ID,
		Duration:  duration,
		Timestamp: time.Now(),
	})

	// Apply delay before next request
	w.applyDelay()
}

// makeRequest makes an HTTP request through a proxy
func (w *Worker) makeRequest(targetURL string, prx *proxy.Proxy) (string, error) {
	// Parse proxy URL
	proxyURL, err := url.Parse(prx.URL())
	if err != nil {
		return "", fmt.Errorf("invalid proxy URL: %w", err)
	}

	// Create transport with proxy
	transport := &http.Transport{
		Proxy:               http.ProxyURL(proxyURL),
		MaxIdleConns:        10,
		IdleConnTimeout:     30 * time.Second,
		TLSHandshakeTimeout: 10 * time.Second,
	}

	// Create client
	client := &http.Client{
		Transport: transport,
		Timeout:   w.config.RequestTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return fmt.Errorf("too many redirects")
			}
			return nil
		},
	}

	// Create request
	req, err := http.NewRequestWithContext(context.Background(), "GET", targetURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	// Set headers from stealth manager
	headers := w.stealth.GetHeaders()
	for key, value := range headers {
		req.Header.Set(key, value)
	}

	// Additional headers
	req.Header.Set("Referer", "https://www.google.com/")
	req.Header.Set("DNT", "1")

	// Make request
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	// Check status code
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("bad status code: %d", resp.StatusCode)
	}

	// Read body
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read body: %w", err)
	}

	return string(body), nil
}

// handleRequestError handles request errors
func (w *Worker) handleRequestError(task *Task, prx *proxy.Proxy, err error, duration time.Duration) {
	// Retry if possible
	if task.Retry < w.config.MaxRetries {
		task.Retry++
		w.retryTask(task)
		return
	}

	w.sendResult(&Result{
		TaskID:    task.ID,
		Dork:      task.Dork,
		Status:    StatusError,
		Error:     err.Error(),
		ProxyID:   prx.ID,
		Duration:  duration,
		Timestamp: time.Now(),
	})
	atomic.AddInt64(&w.stats.TasksFailed, 1)
}

// retryTask requeues a task for retry
func (w *Worker) retryTask(task *Task) {
	// Apply retry delay
	time.Sleep(w.config.RetryDelay)

	select {
	case w.tasks <- task:
		// Requeued successfully
	default:
		// Buffer full, send error
		w.sendResult(&Result{
			TaskID:    task.ID,
			Dork:      task.Dork,
			Status:    StatusError,
			Error:     "retry buffer full",
			Timestamp: time.Now(),
		})
		atomic.AddInt64(&w.stats.TasksFailed, 1)
	}
}

// sendResult sends a result to the results channel
func (w *Worker) sendResult(result *Result) {
	select {
	case w.results <- result:
		// Sent successfully
	default:
		// Results buffer full, drop oldest or log
	}
}

// applyDelay applies a randomized delay between requests
func (w *Worker) applyDelay() {
	config := stealth.TimingConfig{
		BaseDelay:     w.config.BaseDelay,
		MinDelay:      w.config.MinDelay,
		MaxDelay:      w.config.MaxDelay,
		JitterPercent: 0.3,
	}

	delay := stealth.CalculateDelay(config, nil)
	time.Sleep(delay)
}

// SetEngine sets a custom search engine
func (w *Worker) SetEngine(e engine.SearchEngine) {
	w.engine = e
}

// SetStealthManager sets a custom stealth manager
func (w *Worker) SetStealthManager(m *stealth.Manager) {
	w.stealth = m
}

// IsRunning returns whether the worker is running
func (w *Worker) IsRunning() bool {
	return w.running.Load()
}

// TaskQueueLength returns the current task queue length
func (w *Worker) TaskQueueLength() int {
	return len(w.tasks)
}

// ResultQueueLength returns the current result queue length
func (w *Worker) ResultQueueLength() int {
	return len(w.results)
}
