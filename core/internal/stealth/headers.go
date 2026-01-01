package stealth

import (
	"fmt"
	"math/rand"
	"strings"
)

// HeaderProfile represents a browser's header configuration
type HeaderProfile struct {
	Name           string
	AcceptLanguage []string
	AcceptEncoding string
	Accept         string
	SecChUa        string
	SecChUaPlatform string
	SecChUaMobile  string
	SecFetchDest   string
	SecFetchMode   string
	SecFetchSite   string
	SecFetchUser   string
	CacheControl   string
	Pragma         string
	UpgradeInsecureRequests string
}

var (
	// Chrome profiles
	chromeProfiles = []HeaderProfile{
		{
			Name:           "Chrome 120 Windows",
			AcceptLanguage: []string{"en-US,en;q=0.9", "en-GB,en;q=0.9,en-US;q=0.8", "en;q=0.9"},
			AcceptEncoding: "gzip, deflate, br",
			Accept:         "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
			SecChUa:        `"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"`,
			SecChUaPlatform: `"Windows"`,
			SecChUaMobile:  "?0",
			SecFetchDest:   "document",
			SecFetchMode:   "navigate",
			SecFetchSite:   "none",
			SecFetchUser:   "?1",
			CacheControl:   "max-age=0",
			UpgradeInsecureRequests: "1",
		},
		{
			Name:           "Chrome 120 Mac",
			AcceptLanguage: []string{"en-US,en;q=0.9", "en;q=0.9"},
			AcceptEncoding: "gzip, deflate, br",
			Accept:         "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
			SecChUa:        `"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"`,
			SecChUaPlatform: `"macOS"`,
			SecChUaMobile:  "?0",
			SecFetchDest:   "document",
			SecFetchMode:   "navigate",
			SecFetchSite:   "none",
			SecFetchUser:   "?1",
			CacheControl:   "max-age=0",
			UpgradeInsecureRequests: "1",
		},
		{
			Name:           "Chrome 119 Windows",
			AcceptLanguage: []string{"en-US,en;q=0.9", "en-GB,en;q=0.8"},
			AcceptEncoding: "gzip, deflate, br",
			Accept:         "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
			SecChUa:        `"Google Chrome";v="119", "Chromium";v="119", "Not?A_Brand";v="24"`,
			SecChUaPlatform: `"Windows"`,
			SecChUaMobile:  "?0",
			SecFetchDest:   "document",
			SecFetchMode:   "navigate",
			SecFetchSite:   "none",
			SecFetchUser:   "?1",
			CacheControl:   "max-age=0",
			UpgradeInsecureRequests: "1",
		},
	}

	// Firefox profiles
	firefoxProfiles = []HeaderProfile{
		{
			Name:           "Firefox 121 Windows",
			AcceptLanguage: []string{"en-US,en;q=0.5", "en-GB,en;q=0.5"},
			AcceptEncoding: "gzip, deflate, br",
			Accept:         "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
			SecFetchDest:   "document",
			SecFetchMode:   "navigate",
			SecFetchSite:   "none",
			SecFetchUser:   "?1",
			UpgradeInsecureRequests: "1",
		},
		{
			Name:           "Firefox 121 Mac",
			AcceptLanguage: []string{"en-US,en;q=0.5"},
			AcceptEncoding: "gzip, deflate, br",
			Accept:         "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
			SecFetchDest:   "document",
			SecFetchMode:   "navigate",
			SecFetchSite:   "none",
			SecFetchUser:   "?1",
			UpgradeInsecureRequests: "1",
		},
	}

	// Edge profiles
	edgeProfiles = []HeaderProfile{
		{
			Name:           "Edge 120 Windows",
			AcceptLanguage: []string{"en-US,en;q=0.9"},
			AcceptEncoding: "gzip, deflate, br",
			Accept:         "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
			SecChUa:        `"Not_A Brand";v="8", "Chromium";v="120", "Microsoft Edge";v="120"`,
			SecChUaPlatform: `"Windows"`,
			SecChUaMobile:  "?0",
			SecFetchDest:   "document",
			SecFetchMode:   "navigate",
			SecFetchSite:   "none",
			SecFetchUser:   "?1",
			CacheControl:   "max-age=0",
			UpgradeInsecureRequests: "1",
		},
	}

	// All profiles combined
	allProfiles []HeaderProfile
)

func init() {
	allProfiles = append(allProfiles, chromeProfiles...)
	allProfiles = append(allProfiles, firefoxProfiles...)
	allProfiles = append(allProfiles, edgeProfiles...)
}

// Headers holds the generated HTTP headers
type Headers map[string]string

// HeaderGenerator generates randomized HTTP headers
type HeaderGenerator struct {
	userAgents []string
	profiles   []HeaderProfile
}

// NewHeaderGenerator creates a new header generator
func NewHeaderGenerator(userAgents []string) *HeaderGenerator {
	if len(userAgents) == 0 {
		userAgents = DefaultUserAgents()
	}
	return &HeaderGenerator{
		userAgents: userAgents,
		profiles:   allProfiles,
	}
}

// Generate creates a randomized set of headers
func (g *HeaderGenerator) Generate() Headers {
	profile := g.profiles[rand.Intn(len(g.profiles))]
	ua := g.userAgents[rand.Intn(len(g.userAgents))]
	
	headers := Headers{
		"User-Agent":      ua,
		"Accept":          profile.Accept,
		"Accept-Encoding": profile.AcceptEncoding,
		"Accept-Language": profile.AcceptLanguage[rand.Intn(len(profile.AcceptLanguage))],
		"Connection":      "keep-alive",
	}

	// Add Chrome/Edge specific headers
	if profile.SecChUa != "" {
		headers["Sec-CH-UA"] = profile.SecChUa
		headers["Sec-CH-UA-Mobile"] = profile.SecChUaMobile
		headers["Sec-CH-UA-Platform"] = profile.SecChUaPlatform
	}

	// Add Sec-Fetch headers
	if profile.SecFetchDest != "" {
		headers["Sec-Fetch-Dest"] = profile.SecFetchDest
		headers["Sec-Fetch-Mode"] = profile.SecFetchMode
		headers["Sec-Fetch-Site"] = profile.SecFetchSite
		headers["Sec-Fetch-User"] = profile.SecFetchUser
	}

	// Add cache headers occasionally
	if rand.Float32() < 0.7 {
		if profile.CacheControl != "" {
			headers["Cache-Control"] = profile.CacheControl
		}
	}

	// Add upgrade insecure requests
	if profile.UpgradeInsecureRequests != "" {
		headers["Upgrade-Insecure-Requests"] = profile.UpgradeInsecureRequests
	}

	return headers
}

// GenerateForGoogle creates headers specifically for Google requests
func (g *HeaderGenerator) GenerateForGoogle(googleDomain string) Headers {
	headers := g.Generate()
	
	// Add Google-specific headers
	headers["Host"] = googleDomain
	
	// Sometimes add referer
	if rand.Float32() < 0.3 {
		headers["Referer"] = fmt.Sprintf("https://%s/", googleDomain)
	}

	return headers
}

// GenerateForSearch creates headers for a search request
func (g *HeaderGenerator) GenerateForSearch(googleDomain string, isSubsequentPage bool) Headers {
	headers := g.GenerateForGoogle(googleDomain)

	if isSubsequentPage {
		headers["Sec-Fetch-Site"] = "same-origin"
		headers["Referer"] = fmt.Sprintf("https://%s/search", googleDomain)
	}

	return headers
}

// HeaderOrder returns headers in browser-specific order
// Chrome has a specific header order that differs from other browsers
func (g *HeaderGenerator) HeaderOrder(headers Headers, browserType string) []string {
	var order []string

	switch {
	case strings.Contains(browserType, "Chrome") || strings.Contains(browserType, "Edge"):
		order = []string{
			"Host",
			"Connection",
			"Cache-Control",
			"Upgrade-Insecure-Requests",
			"User-Agent",
			"Accept",
			"Sec-Fetch-Site",
			"Sec-Fetch-Mode",
			"Sec-Fetch-User",
			"Sec-Fetch-Dest",
			"Sec-CH-UA",
			"Sec-CH-UA-Mobile",
			"Sec-CH-UA-Platform",
			"Referer",
			"Accept-Encoding",
			"Accept-Language",
			"Cookie",
		}
	case strings.Contains(browserType, "Firefox"):
		order = []string{
			"Host",
			"User-Agent",
			"Accept",
			"Accept-Language",
			"Accept-Encoding",
			"Connection",
			"Upgrade-Insecure-Requests",
			"Sec-Fetch-Dest",
			"Sec-Fetch-Mode",
			"Sec-Fetch-Site",
			"Sec-Fetch-User",
			"Referer",
			"Cookie",
		}
	default:
		// Generic order
		for k := range headers {
			order = append(order, k)
		}
	}

	return order
}

// DefaultUserAgents returns a list of common user agents
func DefaultUserAgents() []string {
	return []string{
		// Chrome Windows
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
		// Chrome Mac
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
		// Chrome Linux
		"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		// Firefox Windows
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0",
		// Firefox Mac
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 14.2; rv:121.0) Gecko/20100101 Firefox/121.0",
		// Edge Windows
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
		// Safari Mac
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
	}
}

// RandomUserAgent returns a random user agent from the default list
func RandomUserAgent() string {
	agents := DefaultUserAgents()
	return agents[rand.Intn(len(agents))]
}
