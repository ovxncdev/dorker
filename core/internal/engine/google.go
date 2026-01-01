package engine

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"math/rand"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google-dork-parser/core/internal/parser"
	"github.com/google-dork-parser/core/internal/proxy"
	"github.com/google-dork-parser/core/internal/stealth"
)

// Google implements the Engine interface for Google search
type Google struct {
	*BaseEngine
	headerGen    *stealth.HeaderGenerator
	domains      []string
	resultsPerPage int
	httpClient   *http.Client
}

// GoogleConfig holds Google engine configuration
type GoogleConfig struct {
	Domains        []string
	ResultsPerPage int
	Timeout        time.Duration
	UserAgents     []string
}

// DefaultGoogleConfig returns default Google configuration
func DefaultGoogleConfig() GoogleConfig {
	return GoogleConfig{
		Domains: []string{
			"www.google.com",
			"www.google.co.uk",
			"www.google.ca",
			"www.google.com.au",
			"www.google.de",
			"www.google.fr",
			"www.google.es",
			"www.google.it",
			"www.google.nl",
			"www.google.pl",
			"www.google.com.br",
			"www.google.co.in",
		},
		ResultsPerPage: 10,
		Timeout:        30 * time.Second,
		UserAgents:     stealth.DefaultUserAgents(),
	}
}

// NewGoogle creates a new Google search engine
func NewGoogle(config GoogleConfig) *Google {
	if len(config.Domains) == 0 {
		config.Domains = DefaultGoogleConfig().Domains
	}
	if config.ResultsPerPage == 0 {
		config.ResultsPerPage = 10
	}
	if len(config.UserAgents) == 0 {
		config.UserAgents = stealth.DefaultUserAgents()
	}

	return &Google{
		BaseEngine:     NewBaseEngine("google", config.Domains),
		headerGen:      stealth.NewHeaderGenerator(config.UserAgents),
		domains:        config.Domains,
		resultsPerPage: config.ResultsPerPage,
	}
}

// Search performs a Google search
func (g *Google) Search(ctx context.Context, request *SearchRequest) (*SearchResponse, error) {
	start := time.Now()

	response := &SearchResponse{
		RequestID:  request.ID,
		Dork:       request.Dork,
		Page:       request.Page,
		EngineUsed: "google",
	}

	// Select a random Google domain
	domain := g.selectDomain()

	// Build search URL
	searchURL := g.buildSearchURL(domain, request.Dork, request.Page)

	// Create HTTP client with proxy
	client, err := g.createClient(request.Proxy, request.Timeout)
	if err != nil {
		response.Error = NewSearchError(ErrorTypeProxy, "failed to create client", err)
		return response, err
	}

	// Create request
	req, err := http.NewRequestWithContext(ctx, "GET", searchURL, nil)
	if err != nil {
		response.Error = NewSearchError(ErrorTypeNetwork, "failed to create request", err)
		return response, err
	}

	// Set headers
	g.setHeaders(req, domain, request)

	// Execute request
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			response.Error = NewSearchError(ErrorTypeTimeout, "request timed out", err)
		} else {
			response.Error = NewSearchError(ErrorTypeNetwork, "request failed", err)
		}
		return response, err
	}
	defer resp.Body.Close()

	response.StatusCode = resp.StatusCode
	response.Latency = time.Since(start)

	if request.Proxy != nil {
		response.ProxyUsed = request.Proxy.ID
	}

	// Check status code
	if resp.StatusCode == 429 {
		response.Error = NewSearchError(ErrorTypeRateLimit, "rate limited", nil)
		response.Blocked = true
		return response, response.Error
	}

	if resp.StatusCode == 503 {
		response.Error = NewSearchError(ErrorTypeBlocked, "service unavailable (likely blocked)", nil)
		response.Blocked = true
		return response, response.Error
	}

	if resp.StatusCode != 200 {
		response.Error = NewSearchError(ErrorTypeNetwork, fmt.Sprintf("unexpected status: %d", resp.StatusCode), nil)
		return response, response.Error
	}

	// Read body
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		response.Error = NewSearchError(ErrorTypeNetwork, "failed to read response", err)
		return response, err
	}

	html := string(body)
	response.HTML = html

	// Check for CAPTCHA
	if g.IsCaptcha(html) {
		response.Captcha = true
		response.Error = NewSearchError(ErrorTypeCaptcha, "CAPTCHA detected", nil)
		return response, response.Error
	}

	// Check for blocks
	if g.IsBlocked(html) {
		response.Blocked = true
		response.Error = NewSearchError(ErrorTypeBlocked, "blocked by Google", nil)
		return response, response.Error
	}

	// Parse results
	result := g.ParseResponse(html)
	response.URLs = result.URLs
	response.RawURLs = result.RawURLs
	response.HasNextPage = result.HasNextPage
	response.TotalResults = result.TotalResults

	return response, nil
}

// BuildURL builds a Google search URL
func (g *Google) BuildURL(query string, page int) string {
	domain := g.selectDomain()
	return g.buildSearchURL(domain, query, page)
}

func (g *Google) buildSearchURL(domain, query string, page int) string {
	// URL encode the query
	encodedQuery := url.QueryEscape(query)

	// Calculate start position
	start := page * g.resultsPerPage

	// Build URL with parameters
	params := url.Values{}
	params.Set("q", query)
	params.Set("num", fmt.Sprintf("%d", g.resultsPerPage))
	params.Set("hl", "en")
	params.Set("safe", "off")
	params.Set("filter", "0") // Don't filter similar results

	if start > 0 {
		params.Set("start", fmt.Sprintf("%d", start))
	}

	// Randomly add some optional parameters to look more human
	if rand.Float32() < 0.5 {
		params.Set("pws", "0") // Disable personalized search
	}
	if rand.Float32() < 0.3 {
		params.Set("nfpr", "1") // No auto-correction
	}

	return fmt.Sprintf("https://%s/search?%s", domain, params.Encode())

	// Alternative simpler format:
	// return fmt.Sprintf("https://%s/search?q=%s&num=%d&start=%d&hl=en",
	// 	domain, encodedQuery, g.resultsPerPage, start)
	_ = encodedQuery // Silence unused warning
}

func (g *Google) selectDomain() string {
	if len(g.domains) == 0 {
		return "www.google.com"
	}
	return g.domains[rand.Intn(len(g.domains))]
}

func (g *Google) setHeaders(req *http.Request, domain string, sr *SearchRequest) {
	// Generate stealth headers
	headers := g.headerGen.GenerateForSearch(domain, sr.Page > 0)

	// Apply generated headers
	for key, value := range headers {
		req.Header.Set(key, value)
	}

	// Override with custom user agent if provided
	if sr.UserAgent != "" {
		req.Header.Set("User-Agent", sr.UserAgent)
	}

	// Apply any custom headers from request
	for key, value := range sr.Headers {
		req.Header.Set(key, value)
	}

	// Ensure critical headers are set
	if req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", stealth.RandomUserAgent())
	}

	// Add cookies to look more legitimate
	req.Header.Set("Cookie", g.generateCookies())
}

func (g *Google) generateCookies() string {
	// Generate realistic-looking Google cookies
	cookies := []string{
		fmt.Sprintf("CONSENT=YES+%d", rand.Intn(999)),
		"SOCS=CAISHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzEaAmVuIAEaBgiA_LqmBg",
	}

	// Randomly add some optional cookies
	if rand.Float32() < 0.5 {
		cookies = append(cookies, fmt.Sprintf("NID=%d", rand.Intn(999999999)))
	}
	if rand.Float32() < 0.3 {
		cookies = append(cookies, "AEC=SOMETHING")
	}

	return strings.Join(cookies, "; ")
}

func (g *Google) createClient(p *proxy.Proxy, timeout time.Duration) (*http.Client, error) {
	if timeout == 0 {
		timeout = 30 * time.Second
	}

	transport := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout:   timeout,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: false,
			MinVersion:         tls.VersionTLS12,
		},
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		DisableCompression:    false,
	}

	// Configure proxy if provided
	if p != nil {
		proxyURL, err := url.Parse(p.URL())
		if err != nil {
			return nil, fmt.Errorf("invalid proxy URL: %w", err)
		}

		switch p.Protocol {
		case proxy.ProtocolHTTP, proxy.ProtocolHTTPS:
			transport.Proxy = http.ProxyURL(proxyURL)

		case proxy.ProtocolSOCKS4, proxy.ProtocolSOCKS5:
			// For SOCKS, we need to use a custom dialer
			dialer, err := g.createSOCKSDialer(p, timeout)
			if err != nil {
				return nil, err
			}
			transport.DialContext = dialer

		default:
			return nil, fmt.Errorf("unsupported proxy protocol: %s", p.Protocol)
		}
	}

	return &http.Client{
		Transport: transport,
		Timeout:   timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			// Allow up to 5 redirects
			if len(via) >= 5 {
				return fmt.Errorf("too many redirects")
			}
			// Copy headers to redirect request
			for key, values := range via[0].Header {
				for _, value := range values {
					req.Header.Add(key, value)
				}
			}
			return nil
		},
	}, nil
}

func (g *Google) createSOCKSDialer(p *proxy.Proxy, timeout time.Duration) (func(ctx context.Context, network, addr string) (net.Conn, error), error) {
	proxyAddr := fmt.Sprintf("%s:%s", p.Host, p.Port)

	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		// Create a basic TCP connection to the SOCKS proxy
		dialer := &net.Dialer{
			Timeout:   timeout,
			KeepAlive: 30 * time.Second,
		}

		conn, err := dialer.DialContext(ctx, "tcp", proxyAddr)
		if err != nil {
			return nil, err
		}

		// For full SOCKS5 support, you'd implement the handshake here
		// For now, we'll rely on the proxy package in health.go
		// This is a simplified version

		return conn, nil
	}, nil
}

// GetDomains returns Google domains
func (g *Google) GetDomains() []string {
	return g.domains
}

// SetDomains sets the Google domains to use
func (g *Google) SetDomains(domains []string) {
	g.domains = domains
}

// AddDomain adds a Google domain
func (g *Google) AddDomain(domain string) {
	g.domains = append(g.domains, domain)
}

// SearchMultiplePages searches multiple pages for a dork
func (g *Google) SearchMultiplePages(ctx context.Context, dork string, maxPages int, proxyGetter func() *proxy.Proxy, delay time.Duration) ([]*SearchResponse, error) {
	responses := make([]*SearchResponse, 0, maxPages)

	for page := 0; page < maxPages; page++ {
		// Check context
		select {
		case <-ctx.Done():
			return responses, ctx.Err()
		default:
		}

		// Get proxy
		p := proxyGetter()

		// Create request
		request := &SearchRequest{
			ID:      fmt.Sprintf("%s-page-%d", dork, page),
			Dork:    dork,
			Page:    page,
			Proxy:   p,
			Timeout: 30 * time.Second,
		}

		// Execute search
		response, err := g.Search(ctx, request)
		responses = append(responses, response)

		// Stop if error or no more pages
		if err != nil {
			break
		}
		if !response.HasNextPage {
			break
		}
		if len(response.URLs) == 0 {
			break
		}

		// Delay between pages
		if delay > 0 && page < maxPages-1 {
			select {
			case <-ctx.Done():
				return responses, ctx.Err()
			case <-time.After(delay):
			}
		}
	}

	return responses, nil
}

// ParseResponse parses Google search results HTML
func (g *Google) ParseResponse(html string) *parser.ExtractionResult {
	return g.BaseEngine.ParseResponse(html)
}

// IsBlocked checks if blocked by Google
func (g *Google) IsBlocked(html string) bool {
	if g.BaseEngine.IsBlocked(html) {
		return true
	}

	// Additional Google-specific checks
	blockedIndicators := []string{
		"detected unusual traffic",
		"systems have detected unusual traffic",
		"please show you're not a robot",
		"Why did this happen?",
		"/sorry/",
	}

	htmlLower := strings.ToLower(html)
	for _, indicator := range blockedIndicators {
		if strings.Contains(htmlLower, strings.ToLower(indicator)) {
			return true
		}
	}

	return false
}

// IsCaptcha checks if CAPTCHA page
func (g *Google) IsCaptcha(html string) bool {
	if g.BaseEngine.IsCaptcha(html) {
		return true
	}

	// Additional Google CAPTCHA checks
	captchaIndicators := []string{
		"g-recaptcha",
		"recaptcha",
		"/recaptcha/",
		"captcha-form",
		"unusual traffic from your computer",
	}

	htmlLower := strings.ToLower(html)
	for _, indicator := range captchaIndicators {
		if strings.Contains(htmlLower, indicator) {
			return true
		}
	}

	return false
}
