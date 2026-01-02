package stealth

import (
	"math/rand"
	"sync"
	"time"
)

// BrowserType represents different browser types to impersonate
type BrowserType string

const (
	BrowserChrome  BrowserType = "chrome"
	BrowserFirefox BrowserType = "firefox"
	BrowserSafari  BrowserType = "safari"
	BrowserEdge    BrowserType = "edge"
)

// OSType represents different operating systems
type OSType string

const (
	OSWindows OSType = "windows"
	OSMacOS   OSType = "macos"
	OSLinux   OSType = "linux"
)

// Fingerprint represents a browser fingerprint for stealth requests
type Fingerprint struct {
	ID             string            `json:"id"`
	Browser        BrowserType       `json:"browser"`
	BrowserVersion string            `json:"browser_version"`
	OS             OSType            `json:"os"`
	OSVersion      string            `json:"os_version"`
	UserAgent      string            `json:"user_agent"`
	AcceptLanguage string            `json:"accept_language"`
	AcceptEncoding string            `json:"accept_encoding"`
	Accept         string            `json:"accept"`
	SecChUa        string            `json:"sec_ch_ua"`
	SecChUaPlatform string           `json:"sec_ch_ua_platform"`
	SecChUaMobile  string            `json:"sec_ch_ua_mobile"`
	Headers        map[string]string `json:"headers"`
	JA3            string            `json:"ja3"`
}

// Manager handles fingerprint rotation and stealth settings
type Manager struct {
	mu           sync.RWMutex
	fingerprints []*Fingerprint
	rng          *rand.Rand

	// Settings
	rotateEvery    int // Rotate fingerprint every N requests
	requestCounter int
	current        *Fingerprint
}

// NewManager creates a new stealth manager
func NewManager() *Manager {
	m := &Manager{
		fingerprints: make([]*Fingerprint, 0),
		rng:          rand.New(rand.NewSource(time.Now().UnixNano())),
		rotateEvery:  100,
	}

	// Load default fingerprints
	m.loadDefaultFingerprints()

	// Set initial fingerprint
	if len(m.fingerprints) > 0 {
		m.current = m.fingerprints[0]
	}

	return m
}

// loadDefaultFingerprints loads a set of realistic browser fingerprints
func (m *Manager) loadDefaultFingerprints() {
	m.fingerprints = []*Fingerprint{
		// Chrome on Windows
		{
			ID:              "chrome_win_120",
			Browser:         BrowserChrome,
			BrowserVersion:  "120.0.0.0",
			OS:              OSWindows,
			OSVersion:       "10",
			UserAgent:       "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			AcceptLanguage:  "en-US,en;q=0.9",
			AcceptEncoding:  "gzip, deflate, br",
			Accept:          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
			SecChUa:         `"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"`,
			SecChUaPlatform: `"Windows"`,
			SecChUaMobile:   "?0",
			JA3:             "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0",
		},
		// Chrome on macOS
		{
			ID:              "chrome_mac_120",
			Browser:         BrowserChrome,
			BrowserVersion:  "120.0.0.0",
			OS:              OSMacOS,
			OSVersion:       "14.0",
			UserAgent:       "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			AcceptLanguage:  "en-US,en;q=0.9",
			AcceptEncoding:  "gzip, deflate, br",
			Accept:          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
			SecChUa:         `"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"`,
			SecChUaPlatform: `"macOS"`,
			SecChUaMobile:   "?0",
			JA3:             "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0",
		},
		// Firefox on Windows
		{
			ID:              "firefox_win_121",
			Browser:         BrowserFirefox,
			BrowserVersion:  "121.0",
			OS:              OSWindows,
			OSVersion:       "10",
			UserAgent:       "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
			AcceptLanguage:  "en-US,en;q=0.5",
			AcceptEncoding:  "gzip, deflate, br",
			Accept:          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
			SecChUa:         "",
			SecChUaPlatform: "",
			SecChUaMobile:   "",
			JA3:             "771,4865-4867-4866-49195-49199-52393-52392-49196-49200-49162-49161-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-34-51-43-13-45-28-21,29-23-24-25-256-257,0",
		},
		// Firefox on macOS
		{
			ID:              "firefox_mac_121",
			Browser:         BrowserFirefox,
			BrowserVersion:  "121.0",
			OS:              OSMacOS,
			OSVersion:       "14.0",
			UserAgent:       "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:121.0) Gecko/20100101 Firefox/121.0",
			AcceptLanguage:  "en-US,en;q=0.5",
			AcceptEncoding:  "gzip, deflate, br",
			Accept:          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
			SecChUa:         "",
			SecChUaPlatform: "",
			SecChUaMobile:   "",
			JA3:             "771,4865-4867-4866-49195-49199-52393-52392-49196-49200-49162-49161-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-34-51-43-13-45-28-21,29-23-24-25-256-257,0",
		},
		// Safari on macOS
		{
			ID:              "safari_mac_17",
			Browser:         BrowserSafari,
			BrowserVersion:  "17.0",
			OS:              OSMacOS,
			OSVersion:       "14.0",
			UserAgent:       "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
			AcceptLanguage:  "en-US,en;q=0.9",
			AcceptEncoding:  "gzip, deflate, br",
			Accept:          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			SecChUa:         "",
			SecChUaPlatform: "",
			SecChUaMobile:   "",
			JA3:             "771,4865-4866-4867-49196-49195-52393-49200-49199-52392-49188-49187-49192-49191-49162-49161-49172-49171-157-156-53-47-49160-49170-10,0-23-65281-10-11-16-5-13-18-51-45-43-27,29-23-24-25,0",
		},
		// Edge on Windows
		{
			ID:              "edge_win_120",
			Browser:         BrowserEdge,
			BrowserVersion:  "120.0.0.0",
			OS:              OSWindows,
			OSVersion:       "10",
			UserAgent:       "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
			AcceptLanguage:  "en-US,en;q=0.9",
			AcceptEncoding:  "gzip, deflate, br",
			Accept:          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
			SecChUa:         `"Not_A Brand";v="8", "Chromium";v="120", "Microsoft Edge";v="120"`,
			SecChUaPlatform: `"Windows"`,
			SecChUaMobile:   "?0",
			JA3:             "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0",
		},
		// Chrome on Linux
		{
			ID:              "chrome_linux_120",
			Browser:         BrowserChrome,
			BrowserVersion:  "120.0.0.0",
			OS:              OSLinux,
			OSVersion:       "x86_64",
			UserAgent:       "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			AcceptLanguage:  "en-US,en;q=0.9",
			AcceptEncoding:  "gzip, deflate, br",
			Accept:          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
			SecChUa:         `"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"`,
			SecChUaPlatform: `"Linux"`,
			SecChUaMobile:   "?0",
			JA3:             "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0",
		},
		// Firefox on Linux
		{
			ID:              "firefox_linux_121",
			Browser:         BrowserFirefox,
			BrowserVersion:  "121.0",
			OS:              OSLinux,
			OSVersion:       "x86_64",
			UserAgent:       "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
			AcceptLanguage:  "en-US,en;q=0.5",
			AcceptEncoding:  "gzip, deflate, br",
			Accept:          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
			SecChUa:         "",
			SecChUaPlatform: "",
			SecChUaMobile:   "",
			JA3:             "771,4865-4867-4866-49195-49199-52393-52392-49196-49200-49162-49161-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-34-51-43-13-45-28-21,29-23-24-25-256-257,0",
		},
	}
}

// GetFingerprint returns the current fingerprint, rotating if necessary
func (m *Manager) GetFingerprint() *Fingerprint {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.requestCounter++

	if m.requestCounter >= m.rotateEvery {
		m.rotate()
		m.requestCounter = 0
	}

	return m.current
}

// GetRandomFingerprint returns a random fingerprint without affecting rotation
func (m *Manager) GetRandomFingerprint() *Fingerprint {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if len(m.fingerprints) == 0 {
		return nil
	}

	idx := m.rng.Intn(len(m.fingerprints))
	return m.fingerprints[idx]
}

// rotate selects a new random fingerprint (must hold lock)
func (m *Manager) rotate() {
	if len(m.fingerprints) == 0 {
		return
	}

	idx := m.rng.Intn(len(m.fingerprints))
	m.current = m.fingerprints[idx]
}

// SetRotationInterval sets how often fingerprints rotate
func (m *Manager) SetRotationInterval(requests int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.rotateEvery = requests
}

// AddFingerprint adds a custom fingerprint
func (m *Manager) AddFingerprint(fp *Fingerprint) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.fingerprints = append(m.fingerprints, fp)
}

// GetHeaders returns HTTP headers for the current fingerprint
func (m *Manager) GetHeaders() map[string]string {
	fp := m.GetFingerprint()
	if fp == nil {
		return m.getDefaultHeaders()
	}

	headers := map[string]string{
		"User-Agent":      fp.UserAgent,
		"Accept":          fp.Accept,
		"Accept-Language": fp.AcceptLanguage,
		"Accept-Encoding": fp.AcceptEncoding,
		"Connection":      "keep-alive",
		"Upgrade-Insecure-Requests": "1",
	}

	// Add Chrome/Edge specific headers
	if fp.SecChUa != "" {
		headers["Sec-Ch-Ua"] = fp.SecChUa
		headers["Sec-Ch-Ua-Mobile"] = fp.SecChUaMobile
		headers["Sec-Ch-Ua-Platform"] = fp.SecChUaPlatform
		headers["Sec-Fetch-Dest"] = "document"
		headers["Sec-Fetch-Mode"] = "navigate"
		headers["Sec-Fetch-Site"] = "none"
		headers["Sec-Fetch-User"] = "?1"
	}

	return headers
}

// getDefaultHeaders returns fallback headers
func (m *Manager) getDefaultHeaders() map[string]string {
	return map[string]string{
		"User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		"Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
		"Accept-Language": "en-US,en;q=0.9",
		"Accept-Encoding": "gzip, deflate, br",
		"Connection":      "keep-alive",
	}
}

// GetJA3 returns the JA3 fingerprint string for the current fingerprint
func (m *Manager) GetJA3() string {
	fp := m.GetFingerprint()
	if fp == nil {
		return ""
	}
	return fp.JA3
}

// TimingConfig holds configuration for request timing
type TimingConfig struct {
	BaseDelay     time.Duration `json:"base_delay"`
	MinDelay      time.Duration `json:"min_delay"`
	MaxDelay      time.Duration `json:"max_delay"`
	JitterPercent float64       `json:"jitter_percent"` // 0.0 to 1.0
}

// DefaultTimingConfig returns default timing configuration
func DefaultTimingConfig() TimingConfig {
	return TimingConfig{
		BaseDelay:     8 * time.Second,
		MinDelay:      3 * time.Second,
		MaxDelay:      15 * time.Second,
		JitterPercent: 0.3,
	}
}

// CalculateDelay calculates a randomized delay with jitter
func CalculateDelay(config TimingConfig, rng *rand.Rand) time.Duration {
	if rng == nil {
		rng = rand.New(rand.NewSource(time.Now().UnixNano()))
	}

	// Calculate jitter range
	jitterRange := float64(config.BaseDelay) * config.JitterPercent

	// Random jitter between -jitterRange and +jitterRange
	jitter := (rng.Float64()*2 - 1) * jitterRange

	delay := float64(config.BaseDelay) + jitter

	// Clamp to min/max
	if delay < float64(config.MinDelay) {
		delay = float64(config.MinDelay)
	}
	if delay > float64(config.MaxDelay) {
		delay = float64(config.MaxDelay)
	}

	return time.Duration(delay)
}

// GaussianDelay returns a delay following gaussian distribution
func GaussianDelay(mean, stddev time.Duration, rng *rand.Rand) time.Duration {
	if rng == nil {
		rng = rand.New(rand.NewSource(time.Now().UnixNano()))
	}

	// Box-Muller transform for gaussian
	u1 := rng.Float64()
	u2 := rng.Float64()

	// Avoid log(0)
	for u1 == 0 {
		u1 = rng.Float64()
	}

	z := math_Sqrt(-2*math_Log(u1)) * math_Cos(2*math_Pi*u2)

	delay := float64(mean) + z*float64(stddev)

	// Ensure non-negative
	if delay < 0 {
		delay = float64(mean) / 2
	}

	return time.Duration(delay)
}

// Simple math functions to avoid import
func math_Sqrt(x float64) float64 {
	if x < 0 {
		return 0
	}
	z := x / 2
	for i := 0; i < 10; i++ {
		z = z - (z*z-x)/(2*z)
	}
	return z
}

func math_Log(x float64) float64 {
	if x <= 0 {
		return 0
	}
	// Newton's method approximation
	result := 0.0
	for x >= 2 {
		x /= 2.718281828
		result++
	}
	x--
	term := x
	for i := 1; i < 20; i++ {
		result += term / float64(i)
		term *= -x
	}
	return result
}

const math_Pi = 3.14159265358979323846

func math_Cos(x float64) float64 {
	// Reduce to [0, 2*pi]
	for x < 0 {
		x += 2 * math_Pi
	}
	for x > 2*math_Pi {
		x -= 2 * math_Pi
	}
	// Taylor series
	result := 1.0
	term := 1.0
	for i := 1; i < 20; i++ {
		term *= -x * x / float64((2*i-1)*(2*i))
		result += term
	}
	return result
}
