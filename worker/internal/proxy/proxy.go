package proxy

import (
	"bufio"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
)

// ProxyType represents the protocol type of a proxy
type ProxyType string

const (
	ProxyTypeHTTP   ProxyType = "http"
	ProxyTypeHTTPS  ProxyType = "https"
	ProxyTypeSOCKS4 ProxyType = "socks4"
	ProxyTypeSOCKS5 ProxyType = "socks5"
)

// ProxyStatus represents the current status of a proxy
type ProxyStatus string

const (
	ProxyStatusUnknown     ProxyStatus = "unknown"
	ProxyStatusAlive       ProxyStatus = "alive"
	ProxyStatusDead        ProxyStatus = "dead"
	ProxyStatusSlow        ProxyStatus = "slow"
	ProxyStatusQuarantined ProxyStatus = "quarantined"
)

// Proxy represents a parsed proxy with all its metadata
type Proxy struct {
	ID       string      `json:"id"`
	Host     string      `json:"host"`
	Port     string      `json:"port"`
	Username string      `json:"username,omitempty"`
	Password string      `json:"password,omitempty"`
	Type     ProxyType   `json:"type"`
	Status   ProxyStatus `json:"status"`

	// Statistics
	mu            sync.RWMutex
	TotalRequests int64         `json:"total_requests"`
	SuccessCount  int64         `json:"success_count"`
	FailCount     int64         `json:"fail_count"`
	CaptchaCount  int64         `json:"captcha_count"`
	TotalLatency  time.Duration `json:"total_latency"`
	LastUsed      time.Time     `json:"last_used"`
	LastSuccess   time.Time     `json:"last_success"`
	LastFail      time.Time     `json:"last_fail"`
	CooldownUntil time.Time     `json:"cooldown_until"`
}

// URL returns the proxy URL string for use in HTTP clients
func (p *Proxy) URL() string {
	var auth string
	if p.Username != "" && p.Password != "" {
		auth = fmt.Sprintf("%s:%s@", url.QueryEscape(p.Username), url.QueryEscape(p.Password))
	}
	return fmt.Sprintf("%s://%s%s:%s", p.Type, auth, p.Host, p.Port)
}

// SuccessRate returns the success rate as a percentage
func (p *Proxy) SuccessRate() float64 {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if p.TotalRequests == 0 {
		return 0
	}
	return float64(p.SuccessCount) / float64(p.TotalRequests) * 100
}

// AvgLatency returns average latency per request
func (p *Proxy) AvgLatency() time.Duration {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if p.SuccessCount == 0 {
		return 0
	}
	return p.TotalLatency / time.Duration(p.SuccessCount)
}

// RecordSuccess records a successful request
func (p *Proxy) RecordSuccess(latency time.Duration) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.TotalRequests++
	p.SuccessCount++
	p.TotalLatency += latency
	p.LastUsed = time.Now()
	p.LastSuccess = time.Now()
}

// RecordFail records a failed request
func (p *Proxy) RecordFail() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.TotalRequests++
	p.FailCount++
	p.LastUsed = time.Now()
	p.LastFail = time.Now()
}

// RecordCaptcha records a CAPTCHA encounter
func (p *Proxy) RecordCaptcha() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.CaptchaCount++
}

// IsAvailable checks if proxy is available for use
func (p *Proxy) IsAvailable() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if p.Status == ProxyStatusDead || p.Status == ProxyStatusQuarantined {
		return false
	}
	if time.Now().Before(p.CooldownUntil) {
		return false
	}
	return true
}

// SetCooldown puts the proxy on cooldown
func (p *Proxy) SetCooldown(duration time.Duration) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.CooldownUntil = time.Now().Add(duration)
}

// Parser handles parsing proxies from various formats
type Parser struct {
	// Regex patterns for different formats
	patterns map[string]*regexp.Regexp
}

// NewParser creates a new proxy parser
func NewParser() *Parser {
	return &Parser{
		patterns: map[string]*regexp.Regexp{
			// ip:port
			"ip_port": regexp.MustCompile(`^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{1,5})$`),
			// ip:port:user:pass
			"ip_port_user_pass": regexp.MustCompile(`^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{1,5}):([^:]+):(.+)$`),
			// user:pass@ip:port
			"user_pass_at_ip_port": regexp.MustCompile(`^([^:]+):([^@]+)@(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{1,5})$`),
			// protocol://ip:port
			"proto_ip_port": regexp.MustCompile(`^(https?|socks[45]):\/\/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{1,5})$`),
			// protocol://user:pass@ip:port
			"proto_user_pass_ip_port": regexp.MustCompile(`^(https?|socks[45]):\/\/([^:]+):([^@]+)@(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{1,5})$`),
			// hostname:port (non-IP)
			"host_port": regexp.MustCompile(`^([a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z0-9][-a-zA-Z0-9]*)+):(\d{1,5})$`),
			// protocol://hostname:port
			"proto_host_port": regexp.MustCompile(`^(https?|socks[45]):\/\/([a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z0-9][-a-zA-Z0-9]*)+):(\d{1,5})$`),
		},
	}
}

// ParseLine parses a single proxy line and returns a Proxy struct
func (p *Parser) ParseLine(line string) (*Proxy, error) {
	line = strings.TrimSpace(line)

	// Skip empty lines and comments
	if line == "" || strings.HasPrefix(line, "#") {
		return nil, nil
	}

	proxy := &Proxy{
		Status: ProxyStatusUnknown,
		Type:   ProxyTypeHTTP, // Default type
	}

	// Try each pattern
	// Pattern: protocol://user:pass@ip:port
	if matches := p.patterns["proto_user_pass_ip_port"].FindStringSubmatch(line); matches != nil {
		proxy.Type = parseProxyType(matches[1])
		proxy.Username = matches[2]
		proxy.Password = matches[3]
		proxy.Host = matches[4]
		proxy.Port = matches[5]
		proxy.ID = generateProxyID(proxy)
		return proxy, nil
	}

	// Pattern: protocol://ip:port
	if matches := p.patterns["proto_ip_port"].FindStringSubmatch(line); matches != nil {
		proxy.Type = parseProxyType(matches[1])
		proxy.Host = matches[2]
		proxy.Port = matches[3]
		proxy.ID = generateProxyID(proxy)
		return proxy, nil
	}

	// Pattern: protocol://hostname:port
	if matches := p.patterns["proto_host_port"].FindStringSubmatch(line); matches != nil {
		proxy.Type = parseProxyType(matches[1])
		proxy.Host = matches[2]
		proxy.Port = matches[3]
		proxy.ID = generateProxyID(proxy)
		return proxy, nil
	}

	// Pattern: user:pass@ip:port
	if matches := p.patterns["user_pass_at_ip_port"].FindStringSubmatch(line); matches != nil {
		proxy.Username = matches[1]
		proxy.Password = matches[2]
		proxy.Host = matches[3]
		proxy.Port = matches[4]
		proxy.ID = generateProxyID(proxy)
		return proxy, nil
	}

	// Pattern: ip:port:user:pass
	if matches := p.patterns["ip_port_user_pass"].FindStringSubmatch(line); matches != nil {
		proxy.Host = matches[1]
		proxy.Port = matches[2]
		proxy.Username = matches[3]
		proxy.Password = matches[4]
		proxy.ID = generateProxyID(proxy)
		return proxy, nil
	}

	// Pattern: ip:port
	if matches := p.patterns["ip_port"].FindStringSubmatch(line); matches != nil {
		proxy.Host = matches[1]
		proxy.Port = matches[2]
		proxy.ID = generateProxyID(proxy)
		return proxy, nil
	}

	// Pattern: hostname:port
	if matches := p.patterns["host_port"].FindStringSubmatch(line); matches != nil {
		proxy.Host = matches[1]
		proxy.Port = matches[2]
		proxy.ID = generateProxyID(proxy)
		return proxy, nil
	}

	return nil, fmt.Errorf("invalid proxy format: %s", line)
}

// ParseFile parses a file containing proxies (one per line)
func (p *Parser) ParseFile(filepath string) ([]*Proxy, []error) {
	file, err := os.Open(filepath)
	if err != nil {
		return nil, []error{fmt.Errorf("failed to open file: %w", err)}
	}
	defer file.Close()

	var proxies []*Proxy
	var errors []error

	scanner := bufio.NewScanner(file)
	lineNum := 0

	for scanner.Scan() {
		lineNum++
		line := scanner.Text()

		proxy, err := p.ParseLine(line)
		if err != nil {
			errors = append(errors, fmt.Errorf("line %d: %w", lineNum, err))
			continue
		}

		if proxy != nil {
			proxies = append(proxies, proxy)
		}
	}

	if err := scanner.Err(); err != nil {
		errors = append(errors, fmt.Errorf("scanner error: %w", err))
	}

	return proxies, errors
}

// parseProxyType converts a string to ProxyType
func parseProxyType(s string) ProxyType {
	switch strings.ToLower(s) {
	case "http":
		return ProxyTypeHTTP
	case "https":
		return ProxyTypeHTTPS
	case "socks4":
		return ProxyTypeSOCKS4
	case "socks5":
		return ProxyTypeSOCKS5
	default:
		return ProxyTypeHTTP
	}
}

// generateProxyID creates a unique ID for a proxy
func generateProxyID(p *Proxy) string {
	return fmt.Sprintf("%s_%s_%s", p.Type, p.Host, p.Port)
}
