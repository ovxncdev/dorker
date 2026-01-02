package proxy

import (
	"os"
	"testing"
	"time"
)

func TestParserParseLineFormats(t *testing.T) {
	parser := NewParser()

	tests := []struct {
		name     string
		input    string
		wantHost string
		wantPort string
		wantUser string
		wantPass string
		wantType ProxyType
		wantErr  bool
	}{
		// Basic formats
		{
			name:     "ip:port",
			input:    "192.168.1.1:8080",
			wantHost: "192.168.1.1",
			wantPort: "8080",
			wantType: ProxyTypeHTTP,
		},
		{
			name:     "ip:port:user:pass",
			input:    "192.168.1.1:8080:admin:secret123",
			wantHost: "192.168.1.1",
			wantPort: "8080",
			wantUser: "admin",
			wantPass: "secret123",
			wantType: ProxyTypeHTTP,
		},
		{
			name:     "user:pass@ip:port",
			input:    "admin:secret123@192.168.1.1:8080",
			wantHost: "192.168.1.1",
			wantPort: "8080",
			wantUser: "admin",
			wantPass: "secret123",
			wantType: ProxyTypeHTTP,
		},

		// HTTP/HTTPS formats
		{
			name:     "http://ip:port",
			input:    "http://192.168.1.1:8080",
			wantHost: "192.168.1.1",
			wantPort: "8080",
			wantType: ProxyTypeHTTP,
		},
		{
			name:     "https://ip:port",
			input:    "https://192.168.1.1:8080",
			wantHost: "192.168.1.1",
			wantPort: "8080",
			wantType: ProxyTypeHTTPS,
		},

		// SOCKS formats
		{
			name:     "socks4://ip:port",
			input:    "socks4://192.168.1.1:1080",
			wantHost: "192.168.1.1",
			wantPort: "1080",
			wantType: ProxyTypeSOCKS4,
		},
		{
			name:     "socks5://ip:port",
			input:    "socks5://192.168.1.1:1080",
			wantHost: "192.168.1.1",
			wantPort: "1080",
			wantType: ProxyTypeSOCKS5,
		},
		{
			name:     "socks5://user:pass@ip:port",
			input:    "socks5://admin:secret@192.168.1.1:1080",
			wantHost: "192.168.1.1",
			wantPort: "1080",
			wantUser: "admin",
			wantPass: "secret",
			wantType: ProxyTypeSOCKS5,
		},

		// Hostname formats
		{
			name:     "hostname:port",
			input:    "proxy.example.com:8080",
			wantHost: "proxy.example.com",
			wantPort: "8080",
			wantType: ProxyTypeHTTP,
		},
		{
			name:     "http://hostname:port",
			input:    "http://proxy.example.com:8080",
			wantHost: "proxy.example.com",
			wantPort: "8080",
			wantType: ProxyTypeHTTP,
		},

		// Edge cases
		{
			name:     "comment line",
			input:    "# this is a comment",
			wantHost: "",
			wantErr:  false, // Should return nil, nil
		},
		{
			name:     "empty line",
			input:    "",
			wantHost: "",
			wantErr:  false, // Should return nil, nil
		},
		{
			name:     "whitespace line",
			input:    "   ",
			wantHost: "",
			wantErr:  false, // Should return nil, nil
		},
		{
			name:    "invalid format",
			input:   "not-a-valid-proxy",
			wantErr: true,
		},
		{
			name:    "missing port",
			input:   "192.168.1.1",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			proxy, err := parser.ParseLine(tt.input)

			if tt.wantErr {
				if err == nil {
					t.Errorf("expected error, got nil")
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}

			// Skip nil proxy checks (comments, empty lines)
			if tt.wantHost == "" {
				if proxy != nil {
					t.Errorf("expected nil proxy, got %+v", proxy)
				}
				return
			}

			if proxy == nil {
				t.Errorf("expected proxy, got nil")
				return
			}

			if proxy.Host != tt.wantHost {
				t.Errorf("host = %q, want %q", proxy.Host, tt.wantHost)
			}
			if proxy.Port != tt.wantPort {
				t.Errorf("port = %q, want %q", proxy.Port, tt.wantPort)
			}
			if proxy.Username != tt.wantUser {
				t.Errorf("username = %q, want %q", proxy.Username, tt.wantUser)
			}
			if proxy.Password != tt.wantPass {
				t.Errorf("password = %q, want %q", proxy.Password, tt.wantPass)
			}
			if proxy.Type != tt.wantType {
				t.Errorf("type = %q, want %q", proxy.Type, tt.wantType)
			}
		})
	}
}

func TestProxyURL(t *testing.T) {
	tests := []struct {
		name  string
		proxy *Proxy
		want  string
	}{
		{
			name: "http without auth",
			proxy: &Proxy{
				Type: ProxyTypeHTTP,
				Host: "192.168.1.1",
				Port: "8080",
			},
			want: "http://192.168.1.1:8080",
		},
		{
			name: "http with auth",
			proxy: &Proxy{
				Type:     ProxyTypeHTTP,
				Host:     "192.168.1.1",
				Port:     "8080",
				Username: "admin",
				Password: "secret",
			},
			want: "http://admin:secret@192.168.1.1:8080",
		},
		{
			name: "socks5 with auth",
			proxy: &Proxy{
				Type:     ProxyTypeSOCKS5,
				Host:     "192.168.1.1",
				Port:     "1080",
				Username: "user",
				Password: "pass",
			},
			want: "socks5://user:pass@192.168.1.1:1080",
		},
		{
			name: "special chars in password",
			proxy: &Proxy{
				Type:     ProxyTypeHTTP,
				Host:     "192.168.1.1",
				Port:     "8080",
				Username: "admin",
				Password: "p@ss:word",
			},
			want: "http://admin:p%40ss%3Aword@192.168.1.1:8080",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.proxy.URL()
			if got != tt.want {
				t.Errorf("URL() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestProxyStatistics(t *testing.T) {
	proxy := &Proxy{
		Host: "192.168.1.1",
		Port: "8080",
		Type: ProxyTypeHTTP,
	}

	// Test initial state
	if proxy.SuccessRate() != 0 {
		t.Errorf("initial success rate = %v, want 0", proxy.SuccessRate())
	}

	// Record some successes
	proxy.RecordSuccess(100 * time.Millisecond)
	proxy.RecordSuccess(200 * time.Millisecond)
	proxy.RecordSuccess(300 * time.Millisecond)

	if proxy.TotalRequests != 3 {
		t.Errorf("total requests = %d, want 3", proxy.TotalRequests)
	}
	if proxy.SuccessCount != 3 {
		t.Errorf("success count = %d, want 3", proxy.SuccessCount)
	}
	if proxy.SuccessRate() != 100 {
		t.Errorf("success rate = %v, want 100", proxy.SuccessRate())
	}

	avgLatency := proxy.AvgLatency()
	expectedAvg := 200 * time.Millisecond
	if avgLatency != expectedAvg {
		t.Errorf("avg latency = %v, want %v", avgLatency, expectedAvg)
	}

	// Record a failure
	proxy.RecordFail()

	if proxy.TotalRequests != 4 {
		t.Errorf("total requests = %d, want 4", proxy.TotalRequests)
	}
	if proxy.FailCount != 1 {
		t.Errorf("fail count = %d, want 1", proxy.FailCount)
	}
	if proxy.SuccessRate() != 75 {
		t.Errorf("success rate = %v, want 75", proxy.SuccessRate())
	}

	// Record CAPTCHA
	proxy.RecordCaptcha()
	if proxy.CaptchaCount != 1 {
		t.Errorf("captcha count = %d, want 1", proxy.CaptchaCount)
	}
}

func TestProxyAvailability(t *testing.T) {
	proxy := &Proxy{
		Host:   "192.168.1.1",
		Port:   "8080",
		Type:   ProxyTypeHTTP,
		Status: ProxyStatusAlive,
	}

	// Should be available initially
	if !proxy.IsAvailable() {
		t.Error("proxy should be available initially")
	}

	// Set cooldown
	proxy.SetCooldown(1 * time.Second)
	if proxy.IsAvailable() {
		t.Error("proxy should not be available during cooldown")
	}

	// Wait for cooldown
	time.Sleep(1100 * time.Millisecond)
	if !proxy.IsAvailable() {
		t.Error("proxy should be available after cooldown")
	}

	// Mark as dead
	proxy.Status = ProxyStatusDead
	if proxy.IsAvailable() {
		t.Error("dead proxy should not be available")
	}

	// Mark as quarantined
	proxy.Status = ProxyStatusQuarantined
	if proxy.IsAvailable() {
		t.Error("quarantined proxy should not be available")
	}
}

func TestParseFile(t *testing.T) {
	// Create temp file
	content := `# Test proxies file
192.168.1.1:8080
192.168.1.2:8080:user:pass
socks5://192.168.1.3:1080

# Another comment
http://192.168.1.4:3128
invalid-proxy-line
192.168.1.5:8080
`
	tmpfile, err := os.CreateTemp("", "proxies-*.txt")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpfile.Name())

	if _, err := tmpfile.WriteString(content); err != nil {
		t.Fatal(err)
	}
	if err := tmpfile.Close(); err != nil {
		t.Fatal(err)
	}

	parser := NewParser()
	proxies, errors := parser.ParseFile(tmpfile.Name())

	// Should have 5 valid proxies
	if len(proxies) != 5 {
		t.Errorf("got %d proxies, want 5", len(proxies))
	}

	// Should have 1 error (invalid line)
	if len(errors) != 1 {
		t.Errorf("got %d errors, want 1", len(errors))
	}

	// Verify first proxy
	if proxies[0].Host != "192.168.1.1" {
		t.Errorf("first proxy host = %q, want %q", proxies[0].Host, "192.168.1.1")
	}

	// Verify proxy with auth
	if proxies[1].Username != "user" || proxies[1].Password != "pass" {
		t.Errorf("second proxy auth incorrect")
	}

	// Verify socks5 proxy
	if proxies[2].Type != ProxyTypeSOCKS5 {
		t.Errorf("third proxy type = %q, want socks5", proxies[2].Type)
	}
}
