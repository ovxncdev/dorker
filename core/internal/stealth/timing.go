package stealth

import (
	"math"
	"math/rand"
	"sync"
	"time"
)

// TimingProfile represents different timing behaviors
type TimingProfile string

const (
	TimingAggressive TimingProfile = "aggressive" // Fast, higher risk
	TimingNormal     TimingProfile = "normal"     // Balanced
	TimingCautious   TimingProfile = "cautious"   // Slow, safer
	TimingStealth    TimingProfile = "stealth"    // Very slow, safest
)

// TimingConfig holds timing configuration
type TimingConfig struct {
	Profile          TimingProfile
	MinDelay         time.Duration
	MaxDelay         time.Duration
	BurstSize        int           // Requests before longer pause
	BurstPause       time.Duration // Pause after burst
	SessionMaxReqs   int           // Max requests per session
	SessionCooldown  time.Duration // Cooldown after session max
	JitterPercent    float64       // Random jitter percentage
	SlowdownFactor   float64       // Multiplier as session progresses
	CaptchaCooldown  time.Duration // Cooldown after CAPTCHA
	ErrorCooldown    time.Duration // Cooldown after error
	BlockCooldown    time.Duration // Cooldown after block
}

// DefaultTimingConfigs returns preset timing configurations
var DefaultTimingConfigs = map[TimingProfile]TimingConfig{
	TimingAggressive: {
		Profile:         TimingAggressive,
		MinDelay:        500 * time.Millisecond,
		MaxDelay:        1500 * time.Millisecond,
		BurstSize:       20,
		BurstPause:      3 * time.Second,
		SessionMaxReqs:  200,
		SessionCooldown: 30 * time.Second,
		JitterPercent:   0.2,
		SlowdownFactor:  1.1,
		CaptchaCooldown: 60 * time.Second,
		ErrorCooldown:   5 * time.Second,
		BlockCooldown:   120 * time.Second,
	},
	TimingNormal: {
		Profile:         TimingNormal,
		MinDelay:        1 * time.Second,
		MaxDelay:        3 * time.Second,
		BurstSize:       10,
		BurstPause:      5 * time.Second,
		SessionMaxReqs:  100,
		SessionCooldown: 60 * time.Second,
		JitterPercent:   0.3,
		SlowdownFactor:  1.2,
		CaptchaCooldown: 120 * time.Second,
		ErrorCooldown:   10 * time.Second,
		BlockCooldown:   300 * time.Second,
	},
	TimingCautious: {
		Profile:         TimingCautious,
		MinDelay:        2 * time.Second,
		MaxDelay:        5 * time.Second,
		BurstSize:       5,
		BurstPause:      10 * time.Second,
		SessionMaxReqs:  50,
		SessionCooldown: 120 * time.Second,
		JitterPercent:   0.4,
		SlowdownFactor:  1.3,
		CaptchaCooldown: 300 * time.Second,
		ErrorCooldown:   30 * time.Second,
		BlockCooldown:   600 * time.Second,
	},
	TimingStealth: {
		Profile:         TimingStealth,
		MinDelay:        3 * time.Second,
		MaxDelay:        8 * time.Second,
		BurstSize:       3,
		BurstPause:      15 * time.Second,
		SessionMaxReqs:  30,
		SessionCooldown: 180 * time.Second,
		JitterPercent:   0.5,
		SlowdownFactor:  1.5,
		CaptchaCooldown: 600 * time.Second,
		ErrorCooldown:   60 * time.Second,
		BlockCooldown:   900 * time.Second,
	},
}

// TimingManager manages request timing for stealth
type TimingManager struct {
	config       TimingConfig
	mu           sync.RWMutex
	sessions     map[string]*Session
	rng          *rand.Rand
}

// Session tracks per-proxy session state
type Session struct {
	ProxyID       string
	RequestCount  int
	BurstCount    int
	StartTime     time.Time
	LastRequest   time.Time
	CaptchaCount  int
	ErrorCount    int
	BlockCount    int
	CooldownUntil time.Time
}

// NewTimingManager creates a new timing manager
func NewTimingManager(profile TimingProfile) *TimingManager {
	config, ok := DefaultTimingConfigs[profile]
	if !ok {
		config = DefaultTimingConfigs[TimingNormal]
	}

	return &TimingManager{
		config:   config,
		sessions: make(map[string]*Session),
		rng:      rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

// NewTimingManagerWithConfig creates a timing manager with custom config
func NewTimingManagerWithConfig(config TimingConfig) *TimingManager {
	return &TimingManager{
		config:   config,
		sessions: make(map[string]*Session),
		rng:      rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

// GetDelay returns the delay before next request for a proxy
func (tm *TimingManager) GetDelay(proxyID string) time.Duration {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	session := tm.getOrCreateSession(proxyID)

	// Check if in cooldown
	if time.Now().Before(session.CooldownUntil) {
		return time.Until(session.CooldownUntil)
	}

	// Base delay with gaussian distribution
	delay := tm.gaussianDelay()

	// Apply slowdown factor based on session progress
	progressFactor := 1.0 + (float64(session.RequestCount) / float64(tm.config.SessionMaxReqs) * (tm.config.SlowdownFactor - 1.0))
	delay = time.Duration(float64(delay) * progressFactor)

	// Add burst pause if needed
	if session.BurstCount >= tm.config.BurstSize {
		delay += tm.config.BurstPause
		session.BurstCount = 0
	}

	// Check session limit
	if session.RequestCount >= tm.config.SessionMaxReqs {
		delay += tm.config.SessionCooldown
		session.RequestCount = 0
		session.StartTime = time.Now()
	}

	// Apply jitter
	delay = tm.applyJitter(delay)

	return delay
}

// RecordRequest records a successful request
func (tm *TimingManager) RecordRequest(proxyID string) {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	session := tm.getOrCreateSession(proxyID)
	session.RequestCount++
	session.BurstCount++
	session.LastRequest = time.Now()
}

// RecordCaptcha records a CAPTCHA encounter
func (tm *TimingManager) RecordCaptcha(proxyID string) {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	session := tm.getOrCreateSession(proxyID)
	session.CaptchaCount++
	session.CooldownUntil = time.Now().Add(tm.config.CaptchaCooldown)
	session.BurstCount = 0
}

// RecordError records an error
func (tm *TimingManager) RecordError(proxyID string) {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	session := tm.getOrCreateSession(proxyID)
	session.ErrorCount++
	session.CooldownUntil = time.Now().Add(tm.config.ErrorCooldown)
}

// RecordBlock records a block/ban
func (tm *TimingManager) RecordBlock(proxyID string) {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	session := tm.getOrCreateSession(proxyID)
	session.BlockCount++
	session.CooldownUntil = time.Now().Add(tm.config.BlockCooldown)
	session.RequestCount = 0
	session.BurstCount = 0
}

// IsInCooldown checks if a proxy is in cooldown
func (tm *TimingManager) IsInCooldown(proxyID string) bool {
	tm.mu.RLock()
	defer tm.mu.RUnlock()

	session, ok := tm.sessions[proxyID]
	if !ok {
		return false
	}

	return time.Now().Before(session.CooldownUntil)
}

// GetCooldownRemaining returns remaining cooldown time
func (tm *TimingManager) GetCooldownRemaining(proxyID string) time.Duration {
	tm.mu.RLock()
	defer tm.mu.RUnlock()

	session, ok := tm.sessions[proxyID]
	if !ok {
		return 0
	}

	if time.Now().After(session.CooldownUntil) {
		return 0
	}

	return time.Until(session.CooldownUntil)
}

// ResetSession resets a proxy's session
func (tm *TimingManager) ResetSession(proxyID string) {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	delete(tm.sessions, proxyID)
}

// GetSessionStats returns session statistics
func (tm *TimingManager) GetSessionStats(proxyID string) *Session {
	tm.mu.RLock()
	defer tm.mu.RUnlock()

	session, ok := tm.sessions[proxyID]
	if !ok {
		return nil
	}

	// Return a copy
	copy := *session
	return &copy
}

// GetAllStats returns stats for all sessions
func (tm *TimingManager) GetAllStats() map[string]*Session {
	tm.mu.RLock()
	defer tm.mu.RUnlock()

	stats := make(map[string]*Session)
	for id, session := range tm.sessions {
		copy := *session
		stats[id] = &copy
	}
	return stats
}

func (tm *TimingManager) getOrCreateSession(proxyID string) *Session {
	session, ok := tm.sessions[proxyID]
	if !ok {
		session = &Session{
			ProxyID:   proxyID,
			StartTime: time.Now(),
		}
		tm.sessions[proxyID] = session
	}
	return session
}

// gaussianDelay returns a delay using gaussian distribution
// More human-like than uniform random
func (tm *TimingManager) gaussianDelay() time.Duration {
	min := float64(tm.config.MinDelay)
	max := float64(tm.config.MaxDelay)
	mean := (min + max) / 2
	stdDev := (max - min) / 4

	// Box-Muller transform for gaussian distribution
	u1 := tm.rng.Float64()
	u2 := tm.rng.Float64()
	z := math.Sqrt(-2*math.Log(u1)) * math.Cos(2*math.Pi*u2)

	delay := mean + z*stdDev

	// Clamp to min/max
	if delay < min {
		delay = min
	}
	if delay > max {
		delay = max
	}

	return time.Duration(delay)
}

// applyJitter adds random jitter to a delay
func (tm *TimingManager) applyJitter(delay time.Duration) time.Duration {
	jitter := tm.config.JitterPercent
	factor := 1.0 + (tm.rng.Float64()*2-1)*jitter
	return time.Duration(float64(delay) * factor)
}

// Wait waits for the appropriate delay
func (tm *TimingManager) Wait(proxyID string) {
	delay := tm.GetDelay(proxyID)
	time.Sleep(delay)
}

// WaitWithContext waits with context cancellation support
func (tm *TimingManager) WaitWithCancel(proxyID string, cancel <-chan struct{}) bool {
	delay := tm.GetDelay(proxyID)

	select {
	case <-time.After(delay):
		return true
	case <-cancel:
		return false
	}
}

// HumanDelay returns a simple human-like delay
func HumanDelay(min, max time.Duration) time.Duration {
	if min >= max {
		return min
	}

	// Use gaussian-ish distribution
	mean := float64(min+max) / 2
	stdDev := float64(max-min) / 4

	u1 := rand.Float64()
	u2 := rand.Float64()
	z := math.Sqrt(-2*math.Log(u1)) * math.Cos(2*math.Pi*u2)

	delay := mean + z*stdDev

	if delay < float64(min) {
		delay = float64(min)
	}
	if delay > float64(max) {
		delay = float64(max)
	}

	return time.Duration(delay)
}

// RandomDelay returns a simple random delay between min and max
func RandomDelay(min, max time.Duration) time.Duration {
	if min >= max {
		return min
	}
	return min + time.Duration(rand.Int63n(int64(max-min)))
}

// Sleep sleeps for a random duration between min and max
func Sleep(min, max time.Duration) {
	time.Sleep(RandomDelay(min, max))
}

// HumanSleep sleeps for a human-like duration between min and max
func HumanSleep(min, max time.Duration) {
	time.Sleep(HumanDelay(min, max))
}
