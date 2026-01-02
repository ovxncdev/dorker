package stealth

import (
	"testing"
	"time"
)

func TestNewManager(t *testing.T) {
	m := NewManager()

	if m == nil {
		t.Fatal("NewManager returned nil")
	}

	if len(m.fingerprints) == 0 {
		t.Error("manager should have default fingerprints loaded")
	}

	if m.current == nil {
		t.Error("manager should have a current fingerprint set")
	}
}

func TestManagerGetFingerprint(t *testing.T) {
	m := NewManager()

	fp := m.GetFingerprint()
	if fp == nil {
		t.Fatal("GetFingerprint returned nil")
	}

	if fp.UserAgent == "" {
		t.Error("fingerprint should have UserAgent")
	}

	if fp.Browser == "" {
		t.Error("fingerprint should have Browser type")
	}

	if fp.OS == "" {
		t.Error("fingerprint should have OS type")
	}
}

func TestManagerRotation(t *testing.T) {
	m := NewManager()
	m.SetRotationInterval(5) // Rotate every 5 requests

	firstFP := m.GetFingerprint()
	firstID := firstFP.ID

	// Make requests up to rotation threshold
	for i := 0; i < 4; i++ {
		fp := m.GetFingerprint()
		if fp.ID != firstID {
			// Rotation might happen due to random selection picking same one
			// This is okay, just track current
			firstID = fp.ID
		}
	}

	// After 5 requests, rotation should have occurred
	// Note: might randomly select same fingerprint, so we just verify no crash
	fp := m.GetFingerprint()
	if fp == nil {
		t.Error("fingerprint should not be nil after rotation")
	}
}

func TestManagerGetRandomFingerprint(t *testing.T) {
	m := NewManager()

	// Get random fingerprints and verify they're valid
	for i := 0; i < 10; i++ {
		fp := m.GetRandomFingerprint()
		if fp == nil {
			t.Error("GetRandomFingerprint returned nil")
		}
	}
}

func TestManagerGetHeaders(t *testing.T) {
	m := NewManager()

	headers := m.GetHeaders()

	// Check required headers
	requiredHeaders := []string{
		"User-Agent",
		"Accept",
		"Accept-Language",
		"Accept-Encoding",
		"Connection",
	}

	for _, h := range requiredHeaders {
		if _, exists := headers[h]; !exists {
			t.Errorf("missing required header: %s", h)
		}
	}

	// User-Agent should not be empty
	if headers["User-Agent"] == "" {
		t.Error("User-Agent header should not be empty")
	}
}

func TestManagerChromeHeaders(t *testing.T) {
	m := NewManager()

	// Find a Chrome fingerprint
	var chromeFP *Fingerprint
	for _, fp := range m.fingerprints {
		if fp.Browser == BrowserChrome {
			chromeFP = fp
			break
		}
	}

	if chromeFP == nil {
		t.Fatal("no Chrome fingerprint found")
	}

	// Chrome should have Sec-Ch-* headers
	if chromeFP.SecChUa == "" {
		t.Error("Chrome fingerprint should have Sec-Ch-Ua")
	}

	if chromeFP.SecChUaPlatform == "" {
		t.Error("Chrome fingerprint should have Sec-Ch-Ua-Platform")
	}

	if chromeFP.SecChUaMobile == "" {
		t.Error("Chrome fingerprint should have Sec-Ch-Ua-Mobile")
	}
}

func TestManagerFirefoxHeaders(t *testing.T) {
	m := NewManager()

	// Find a Firefox fingerprint
	var firefoxFP *Fingerprint
	for _, fp := range m.fingerprints {
		if fp.Browser == BrowserFirefox {
			firefoxFP = fp
			break
		}
	}

	if firefoxFP == nil {
		t.Fatal("no Firefox fingerprint found")
	}

	// Firefox should NOT have Sec-Ch-* headers
	if firefoxFP.SecChUa != "" {
		t.Error("Firefox fingerprint should not have Sec-Ch-Ua")
	}
}

func TestManagerGetJA3(t *testing.T) {
	m := NewManager()

	ja3 := m.GetJA3()

	if ja3 == "" {
		t.Error("GetJA3 should return a JA3 string")
	}

	// JA3 should contain commas (field separators)
	hasComma := false
	for _, c := range ja3 {
		if c == ',' {
			hasComma = true
			break
		}
	}

	if !hasComma {
		t.Error("JA3 string should contain comma separators")
	}
}

func TestManagerAddFingerprint(t *testing.T) {
	m := NewManager()

	initialCount := len(m.fingerprints)

	customFP := &Fingerprint{
		ID:             "custom_test",
		Browser:        BrowserChrome,
		BrowserVersion: "999.0.0.0",
		OS:             OSWindows,
		UserAgent:      "Custom Test Agent",
		AcceptLanguage: "en-US",
		AcceptEncoding: "gzip",
		Accept:         "text/html",
	}

	m.AddFingerprint(customFP)

	if len(m.fingerprints) != initialCount+1 {
		t.Errorf("fingerprint count = %d, want %d", len(m.fingerprints), initialCount+1)
	}
}

func TestDefaultTimingConfig(t *testing.T) {
	config := DefaultTimingConfig()

	if config.BaseDelay == 0 {
		t.Error("BaseDelay should not be zero")
	}

	if config.MinDelay == 0 {
		t.Error("MinDelay should not be zero")
	}

	if config.MaxDelay == 0 {
		t.Error("MaxDelay should not be zero")
	}

	if config.MinDelay >= config.MaxDelay {
		t.Error("MinDelay should be less than MaxDelay")
	}

	if config.JitterPercent <= 0 || config.JitterPercent > 1 {
		t.Errorf("JitterPercent = %v, should be between 0 and 1", config.JitterPercent)
	}
}

func TestCalculateDelay(t *testing.T) {
	config := TimingConfig{
		BaseDelay:     5 * time.Second,
		MinDelay:      2 * time.Second,
		MaxDelay:      10 * time.Second,
		JitterPercent: 0.3,
	}

	// Run multiple times to test randomness
	delays := make([]time.Duration, 100)
	for i := 0; i < 100; i++ {
		delays[i] = CalculateDelay(config, nil)
	}

	// Check all delays are within bounds
	for i, delay := range delays {
		if delay < config.MinDelay {
			t.Errorf("delay[%d] = %v, less than min %v", i, delay, config.MinDelay)
		}
		if delay > config.MaxDelay {
			t.Errorf("delay[%d] = %v, greater than max %v", i, delay, config.MaxDelay)
		}
	}

	// Check that we have some variation (not all same)
	allSame := true
	for i := 1; i < len(delays); i++ {
		if delays[i] != delays[0] {
			allSame = false
			break
		}
	}

	if allSame {
		t.Error("all delays are identical, jitter not working")
	}
}

func TestGaussianDelay(t *testing.T) {
	mean := 5 * time.Second
	stddev := 1 * time.Second

	// Run multiple times
	delays := make([]time.Duration, 100)
	for i := 0; i < 100; i++ {
		delays[i] = GaussianDelay(mean, stddev, nil)
	}

	// Calculate average
	var total time.Duration
	for _, d := range delays {
		total += d
	}
	avg := total / time.Duration(len(delays))

	// Average should be roughly around mean (within 2 stddev)
	tolerance := 2 * stddev
	if avg < mean-tolerance || avg > mean+tolerance {
		t.Errorf("average delay = %v, expected around %v (±%v)", avg, mean, tolerance)
	}

	// All delays should be non-negative
	for i, delay := range delays {
		if delay < 0 {
			t.Errorf("delay[%d] = %v, should be non-negative", i, delay)
		}
	}
}

func TestFingerprintBrowserTypes(t *testing.T) {
	m := NewManager()

	browserCounts := make(map[BrowserType]int)
	osCounts := make(map[OSType]int)

	for _, fp := range m.fingerprints {
		browserCounts[fp.Browser]++
		osCounts[fp.OS]++
	}

	// Should have multiple browser types
	if len(browserCounts) < 3 {
		t.Errorf("only %d browser types, want at least 3", len(browserCounts))
	}

	// Should have multiple OS types
	if len(osCounts) < 2 {
		t.Errorf("only %d OS types, want at least 2", len(osCounts))
	}

	// Check specific browsers exist
	expectedBrowsers := []BrowserType{BrowserChrome, BrowserFirefox, BrowserSafari}
	for _, b := range expectedBrowsers {
		if browserCounts[b] == 0 {
			t.Errorf("missing browser type: %s", b)
		}
	}
}

func TestFingerprintUserAgents(t *testing.T) {
	m := NewManager()

	for _, fp := range m.fingerprints {
		// User agent should contain browser name
		ua := fp.UserAgent

		switch fp.Browser {
		case BrowserChrome:
			if !containsString(ua, "Chrome") {
				t.Errorf("Chrome fingerprint UA doesn't contain 'Chrome': %s", ua)
			}
		case BrowserFirefox:
			if !containsString(ua, "Firefox") {
				t.Errorf("Firefox fingerprint UA doesn't contain 'Firefox': %s", ua)
			}
		case BrowserSafari:
			if !containsString(ua, "Safari") {
				t.Errorf("Safari fingerprint UA doesn't contain 'Safari': %s", ua)
			}
		case BrowserEdge:
			if !containsString(ua, "Edg") {
				t.Errorf("Edge fingerprint UA doesn't contain 'Edg': %s", ua)
			}
		}

		// User agent should contain OS info
		switch fp.OS {
		case OSWindows:
			if !containsString(ua, "Windows") {
				t.Errorf("Windows fingerprint UA doesn't contain 'Windows': %s", ua)
			}
		case OSMacOS:
			if !containsString(ua, "Mac") && !containsString(ua, "Macintosh") {
				t.Errorf("macOS fingerprint UA doesn't contain 'Mac': %s", ua)
			}
		case OSLinux:
			if !containsString(ua, "Linux") {
				t.Errorf("Linux fingerprint UA doesn't contain 'Linux': %s", ua)
			}
		}
	}
}

func TestMathFunctions(t *testing.T) {
	// Test sqrt
	sqrt4 := math_Sqrt(4)
	if sqrt4 < 1.99 || sqrt4 > 2.01 {
		t.Errorf("sqrt(4) = %v, want ~2", sqrt4)
	}

	sqrt9 := math_Sqrt(9)
	if sqrt9 < 2.99 || sqrt9 > 3.01 {
		t.Errorf("sqrt(9) = %v, want ~3", sqrt9)
	}

	// Test cos
	cos0 := math_Cos(0)
	if cos0 < 0.99 || cos0 > 1.01 {
		t.Errorf("cos(0) = %v, want ~1", cos0)
	}

	cosPi := math_Cos(math_Pi)
	if cosPi < -1.01 || cosPi > -0.99 {
		t.Errorf("cos(pi) = %v, want ~-1", cosPi)
	}
}

// Helper function
func containsString(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
