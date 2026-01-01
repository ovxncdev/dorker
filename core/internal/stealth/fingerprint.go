package stealth

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/rand"
	"strings"
	"time"
)

// Fingerprint represents a browser fingerprint
type Fingerprint struct {
	ID              string
	UserAgent       string
	Platform        string
	Vendor          string
	Language        string
	Languages       []string
	ScreenWidth     int
	ScreenHeight    int
	ColorDepth      int
	PixelRatio      float64
	Timezone        string
	TimezoneOffset  int
	DoNotTrack      string
	HardwareConcurrency int
	DeviceMemory    int
	MaxTouchPoints  int
	WebGLVendor     string
	WebGLRenderer   string
	Plugins         []string
	MimeTypes       []string
	Canvas          string
	WebGL           string
	AudioContext    string
	Fonts           []string
}

// ScreenResolution represents a screen size
type ScreenResolution struct {
	Width  int
	Height int
}

var (
	// Common screen resolutions
	screenResolutions = []ScreenResolution{
		{1920, 1080},
		{1366, 768},
		{1536, 864},
		{1440, 900},
		{1280, 720},
		{2560, 1440},
		{1600, 900},
		{1280, 800},
		{1680, 1050},
		{2560, 1080},
		{3840, 2160},
	}

	// Common timezones
	timezones = []struct {
		Name   string
		Offset int
	}{
		{"America/New_York", -300},
		{"America/Chicago", -360},
		{"America/Denver", -420},
		{"America/Los_Angeles", -480},
		{"Europe/London", 0},
		{"Europe/Paris", 60},
		{"Europe/Berlin", 60},
		{"Asia/Tokyo", 540},
		{"Asia/Shanghai", 480},
		{"Australia/Sydney", 600},
	}

	// WebGL vendors and renderers
	webGLConfigs = []struct {
		Vendor   string
		Renderer string
	}{
		{"Google Inc. (NVIDIA)", "ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Direct3D11 vs_5_0 ps_5_0, D3D11)"},
		{"Google Inc. (NVIDIA)", "ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)"},
		{"Google Inc. (NVIDIA)", "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)"},
		{"Google Inc. (AMD)", "ANGLE (AMD, AMD Radeon RX 580 Series Direct3D11 vs_5_0 ps_5_0, D3D11)"},
		{"Google Inc. (AMD)", "ANGLE (AMD, AMD Radeon RX 5700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)"},
		{"Google Inc. (Intel)", "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)"},
		{"Google Inc. (Intel)", "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)"},
		{"Apple Inc.", "Apple M1"},
		{"Apple Inc.", "Apple M2"},
		{"Apple Inc.", "Apple M1 Pro"},
	}

	// Common fonts
	commonFonts = []string{
		"Arial",
		"Arial Black",
		"Calibri",
		"Cambria",
		"Comic Sans MS",
		"Consolas",
		"Courier New",
		"Georgia",
		"Helvetica",
		"Impact",
		"Lucida Console",
		"Lucida Sans Unicode",
		"Microsoft Sans Serif",
		"Palatino Linotype",
		"Segoe UI",
		"Tahoma",
		"Times New Roman",
		"Trebuchet MS",
		"Verdana",
	}

	// Chrome plugins (modern Chrome has limited plugins)
	chromePlugins = []string{
		"PDF Viewer",
		"Chrome PDF Viewer",
		"Chromium PDF Viewer",
		"Microsoft Edge PDF Viewer",
		"WebKit built-in PDF",
	}

	// Chrome MIME types
	chromeMimeTypes = []string{
		"application/pdf",
		"text/pdf",
	}
)

// FingerprintGenerator generates consistent browser fingerprints
type FingerprintGenerator struct {
	seed int64
	rng  *rand.Rand
}

// NewFingerprintGenerator creates a new fingerprint generator
func NewFingerprintGenerator() *FingerprintGenerator {
	seed := time.Now().UnixNano()
	return &FingerprintGenerator{
		seed: seed,
		rng:  rand.New(rand.NewSource(seed)),
	}
}

// NewFingerprintGeneratorWithSeed creates a generator with a specific seed
// Useful for creating consistent fingerprints per proxy
func NewFingerprintGeneratorWithSeed(seed int64) *FingerprintGenerator {
	return &FingerprintGenerator{
		seed: seed,
		rng:  rand.New(rand.NewSource(seed)),
	}
}

// Generate creates a new random fingerprint
func (g *FingerprintGenerator) Generate(userAgent string) *Fingerprint {
	screen := screenResolutions[g.rng.Intn(len(screenResolutions))]
	tz := timezones[g.rng.Intn(len(timezones))]
	webgl := webGLConfigs[g.rng.Intn(len(webGLConfigs))]

	fp := &Fingerprint{
		UserAgent:       userAgent,
		ScreenWidth:     screen.Width,
		ScreenHeight:    screen.Height,
		ColorDepth:      24,
		PixelRatio:      g.randomPixelRatio(),
		Timezone:        tz.Name,
		TimezoneOffset:  tz.Offset,
		DoNotTrack:      g.randomDoNotTrack(),
		HardwareConcurrency: g.randomHardwareConcurrency(),
		DeviceMemory:    g.randomDeviceMemory(),
		MaxTouchPoints:  0, // Desktop
		WebGLVendor:     webgl.Vendor,
		WebGLRenderer:   webgl.Renderer,
		Plugins:         g.randomPlugins(),
		MimeTypes:       chromeMimeTypes,
		Fonts:           g.randomFonts(),
	}

	// Set platform based on user agent
	fp.Platform = g.detectPlatform(userAgent)
	fp.Vendor = g.detectVendor(userAgent)
	fp.Language = g.randomLanguage()
	fp.Languages = g.randomLanguages(fp.Language)

	// Generate hashes for canvas, webgl, audio
	fp.Canvas = g.generateCanvasHash(fp)
	fp.WebGL = g.generateWebGLHash(fp)
	fp.AudioContext = g.generateAudioHash(fp)

	// Generate unique ID
	fp.ID = g.generateFingerprintID(fp)

	return fp
}

// GenerateForProxy creates a consistent fingerprint for a proxy
// Same proxy always gets same fingerprint
func (g *FingerprintGenerator) GenerateForProxy(proxy string, userAgent string) *Fingerprint {
	// Create seed from proxy string
	hash := sha256.Sum256([]byte(proxy))
	seed := int64(hash[0])<<56 | int64(hash[1])<<48 | int64(hash[2])<<40 | int64(hash[3])<<32 |
		int64(hash[4])<<24 | int64(hash[5])<<16 | int64(hash[6])<<8 | int64(hash[7])

	// Create deterministic generator
	proxyGen := NewFingerprintGeneratorWithSeed(seed)
	return proxyGen.Generate(userAgent)
}

func (g *FingerprintGenerator) randomPixelRatio() float64 {
	ratios := []float64{1.0, 1.25, 1.5, 2.0}
	return ratios[g.rng.Intn(len(ratios))]
}

func (g *FingerprintGenerator) randomDoNotTrack() string {
	options := []string{"1", "unspecified"}
	return options[g.rng.Intn(len(options))]
}

func (g *FingerprintGenerator) randomHardwareConcurrency() int {
	options := []int{4, 6, 8, 12, 16}
	return options[g.rng.Intn(len(options))]
}

func (g *FingerprintGenerator) randomDeviceMemory() int {
	options := []int{4, 8, 16, 32}
	return options[g.rng.Intn(len(options))]
}

func (g *FingerprintGenerator) randomPlugins() []string {
	count := g.rng.Intn(3) + 1
	plugins := make([]string, count)
	perm := g.rng.Perm(len(chromePlugins))
	for i := 0; i < count; i++ {
		plugins[i] = chromePlugins[perm[i]]
	}
	return plugins
}

func (g *FingerprintGenerator) randomFonts() []string {
	count := g.rng.Intn(5) + 10 // 10-14 fonts
	fonts := make([]string, count)
	perm := g.rng.Perm(len(commonFonts))
	for i := 0; i < count && i < len(commonFonts); i++ {
		fonts[i] = commonFonts[perm[i]]
	}
	return fonts
}

func (g *FingerprintGenerator) randomLanguage() string {
	languages := []string{"en-US", "en-GB", "en"}
	return languages[g.rng.Intn(len(languages))]
}

func (g *FingerprintGenerator) randomLanguages(primary string) []string {
	switch primary {
	case "en-US":
		return []string{"en-US", "en"}
	case "en-GB":
		return []string{"en-GB", "en"}
	default:
		return []string{"en"}
	}
}

func (g *FingerprintGenerator) detectPlatform(userAgent string) string {
	ua := strings.ToLower(userAgent)
	switch {
	case strings.Contains(ua, "windows"):
		return "Win32"
	case strings.Contains(ua, "macintosh") || strings.Contains(ua, "mac os"):
		return "MacIntel"
	case strings.Contains(ua, "linux"):
		return "Linux x86_64"
	default:
		return "Win32"
	}
}

func (g *FingerprintGenerator) detectVendor(userAgent string) string {
	ua := strings.ToLower(userAgent)
	switch {
	case strings.Contains(ua, "chrome"):
		return "Google Inc."
	case strings.Contains(ua, "firefox"):
		return ""
	case strings.Contains(ua, "safari") && !strings.Contains(ua, "chrome"):
		return "Apple Computer, Inc."
	case strings.Contains(ua, "edge"):
		return "Google Inc."
	default:
		return "Google Inc."
	}
}

func (g *FingerprintGenerator) generateCanvasHash(fp *Fingerprint) string {
	data := fmt.Sprintf("canvas:%s:%d:%d:%s",
		fp.UserAgent, fp.ScreenWidth, fp.ScreenHeight, fp.Platform)
	hash := sha256.Sum256([]byte(data))
	return hex.EncodeToString(hash[:16])
}

func (g *FingerprintGenerator) generateWebGLHash(fp *Fingerprint) string {
	data := fmt.Sprintf("webgl:%s:%s:%s",
		fp.WebGLVendor, fp.WebGLRenderer, fp.Platform)
	hash := sha256.Sum256([]byte(data))
	return hex.EncodeToString(hash[:16])
}

func (g *FingerprintGenerator) generateAudioHash(fp *Fingerprint) string {
	data := fmt.Sprintf("audio:%s:%d:%s",
		fp.UserAgent, fp.HardwareConcurrency, fp.Platform)
	hash := sha256.Sum256([]byte(data))
	return hex.EncodeToString(hash[:16])
}

func (g *FingerprintGenerator) generateFingerprintID(fp *Fingerprint) string {
	data := fmt.Sprintf("%s:%s:%s:%s",
		fp.Canvas, fp.WebGL, fp.AudioContext, fp.UserAgent)
	hash := sha256.Sum256([]byte(data))
	return hex.EncodeToString(hash[:12])
}

// ToMap converts fingerprint to a map for easy access
func (fp *Fingerprint) ToMap() map[string]interface{} {
	return map[string]interface{}{
		"id":                  fp.ID,
		"userAgent":           fp.UserAgent,
		"platform":            fp.Platform,
		"vendor":              fp.Vendor,
		"language":            fp.Language,
		"languages":           fp.Languages,
		"screenWidth":         fp.ScreenWidth,
		"screenHeight":        fp.ScreenHeight,
		"colorDepth":          fp.ColorDepth,
		"pixelRatio":          fp.PixelRatio,
		"timezone":            fp.Timezone,
		"timezoneOffset":      fp.TimezoneOffset,
		"doNotTrack":          fp.DoNotTrack,
		"hardwareConcurrency": fp.HardwareConcurrency,
		"deviceMemory":        fp.DeviceMemory,
		"maxTouchPoints":      fp.MaxTouchPoints,
		"webglVendor":         fp.WebGLVendor,
		"webglRenderer":       fp.WebGLRenderer,
		"plugins":             fp.Plugins,
		"mimeTypes":           fp.MimeTypes,
		"canvas":              fp.Canvas,
		"webgl":               fp.WebGL,
		"audioContext":        fp.AudioContext,
		"fonts":               fp.Fonts,
	}
}

// String returns a string representation of the fingerprint
func (fp *Fingerprint) String() string {
	return fmt.Sprintf("Fingerprint{ID: %s, Platform: %s, Screen: %dx%d}",
		fp.ID, fp.Platform, fp.ScreenWidth, fp.ScreenHeight)
}
