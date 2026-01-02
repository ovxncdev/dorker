package protocol

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sync"
	"time"
)

// MessageType defines the type of IPC message
type MessageType string

const (
	// Commands from CLI to Worker
	MsgTypeInit      MessageType = "init"
	MsgTypeTask      MessageType = "task"
	MsgTypeTaskBatch MessageType = "task_batch"
	MsgTypePause     MessageType = "pause"
	MsgTypeResume    MessageType = "resume"
	MsgTypeShutdown  MessageType = "shutdown"
	MsgTypeGetStats  MessageType = "get_stats"

	// Responses from Worker to CLI
	MsgTypeStatus    MessageType = "status"
	MsgTypeResult    MessageType = "result"
	MsgTypeStats     MessageType = "stats"
	MsgTypeError     MessageType = "error"
	MsgTypeLog       MessageType = "log"
	MsgTypeProgress  MessageType = "progress"
	MsgTypeProxyInfo MessageType = "proxy_info"
)

// Message is the base IPC message structure
type Message struct {
	Type      MessageType    `json:"type"`
	Timestamp int64          `json:"ts"`
	ID        string         `json:"id,omitempty"`
	Data      map[string]any `json:"data,omitempty"`
}

// NewMessage creates a new message with current timestamp
func NewMessage(msgType MessageType) *Message {
	return &Message{
		Type:      msgType,
		Timestamp: time.Now().UnixMilli(),
		Data:      make(map[string]any),
	}
}

// SetData sets a key-value pair in the message data
func (m *Message) SetData(key string, value any) *Message {
	if m.Data == nil {
		m.Data = make(map[string]any)
	}
	m.Data[key] = value
	return m
}

// GetString gets a string value from data
func (m *Message) GetString(key string) string {
	if m.Data == nil {
		return ""
	}
	if v, ok := m.Data[key].(string); ok {
		return v
	}
	return ""
}

// GetInt gets an int value from data
func (m *Message) GetInt(key string) int {
	if m.Data == nil {
		return 0
	}
	switch v := m.Data[key].(type) {
	case int:
		return v
	case float64:
		return int(v)
	case int64:
		return int(v)
	}
	return 0
}

// GetFloat gets a float value from data
func (m *Message) GetFloat(key string) float64 {
	if m.Data == nil {
		return 0
	}
	switch v := m.Data[key].(type) {
	case float64:
		return v
	case int:
		return float64(v)
	case int64:
		return float64(v)
	}
	return 0
}

// GetBool gets a bool value from data
func (m *Message) GetBool(key string) bool {
	if m.Data == nil {
		return false
	}
	if v, ok := m.Data[key].(bool); ok {
		return v
	}
	return false
}

// GetStringSlice gets a string slice from data
func (m *Message) GetStringSlice(key string) []string {
	if m.Data == nil {
		return nil
	}
	if v, ok := m.Data[key].([]any); ok {
		result := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok {
				result = append(result, s)
			}
		}
		return result
	}
	return nil
}

// InitConfig represents initialization configuration
type InitConfig struct {
	Workers        int           `json:"workers"`
	Timeout        time.Duration `json:"timeout"`
	BaseDelay      time.Duration `json:"base_delay"`
	MinDelay       time.Duration `json:"min_delay"`
	MaxDelay       time.Duration `json:"max_delay"`
	MaxRetries     int           `json:"max_retries"`
	ResultsPerPage int           `json:"results_per_page"`
	Proxies        []string      `json:"proxies"`
	ProxyFile      string        `json:"proxy_file"`
}

// ParseInitConfig parses init config from message data
func ParseInitConfig(m *Message) *InitConfig {
	config := &InitConfig{
		Workers:        m.GetInt("workers"),
		Timeout:        time.Duration(m.GetInt("timeout")) * time.Millisecond,
		BaseDelay:      time.Duration(m.GetInt("base_delay")) * time.Millisecond,
		MinDelay:       time.Duration(m.GetInt("min_delay")) * time.Millisecond,
		MaxDelay:       time.Duration(m.GetInt("max_delay")) * time.Millisecond,
		MaxRetries:     m.GetInt("max_retries"),
		ResultsPerPage: m.GetInt("results_per_page"),
		Proxies:        m.GetStringSlice("proxies"),
		ProxyFile:      m.GetString("proxy_file"),
	}

	// Apply defaults
	if config.Workers == 0 {
		config.Workers = 10
	}
	if config.Timeout == 0 {
		config.Timeout = 30 * time.Second
	}
	if config.BaseDelay == 0 {
		config.BaseDelay = 8 * time.Second
	}
	if config.MinDelay == 0 {
		config.MinDelay = 3 * time.Second
	}
	if config.MaxDelay == 0 {
		config.MaxDelay = 15 * time.Second
	}
	if config.MaxRetries == 0 {
		config.MaxRetries = 3
	}
	if config.ResultsPerPage == 0 {
		config.ResultsPerPage = 100
	}

	return config
}

// TaskData represents a single task
type TaskData struct {
	ID   string `json:"id"`
	Dork string `json:"dork"`
	Page int    `json:"page"`
}

// ParseTaskData parses task data from message
func ParseTaskData(m *Message) *TaskData {
	return &TaskData{
		ID:   m.GetString("task_id"),
		Dork: m.GetString("dork"),
		Page: m.GetInt("page"),
	}
}

// ResultData represents task result
type ResultData struct {
	TaskID   string   `json:"task_id"`
	Dork     string   `json:"dork"`
	URLs     []string `json:"urls"`
	Status   string   `json:"status"`
	Error    string   `json:"error,omitempty"`
	ProxyID  string   `json:"proxy_id"`
	Duration int64    `json:"duration_ms"`
}

// ToMessage converts result data to a message
func (r *ResultData) ToMessage() *Message {
	msg := NewMessage(MsgTypeResult)
	msg.SetData("task_id", r.TaskID)
	msg.SetData("dork", r.Dork)
	msg.SetData("urls", r.URLs)
	msg.SetData("status", r.Status)
	msg.SetData("proxy_id", r.ProxyID)
	msg.SetData("duration_ms", r.Duration)
	if r.Error != "" {
		msg.SetData("error", r.Error)
	}
	return msg
}

// StatsData represents worker statistics
type StatsData struct {
	TasksTotal     int64   `json:"tasks_total"`
	TasksCompleted int64   `json:"tasks_completed"`
	TasksFailed    int64   `json:"tasks_failed"`
	TasksPending   int64   `json:"tasks_pending"`
	URLsFound      int64   `json:"urls_found"`
	CaptchaCount   int64   `json:"captcha_count"`
	BlockCount     int64   `json:"block_count"`
	ProxiesAlive   int     `json:"proxies_alive"`
	ProxiesDead    int     `json:"proxies_dead"`
	RequestsPerSec float64 `json:"requests_per_sec"`
	ElapsedMs      int64   `json:"elapsed_ms"`
	ETAMs          int64   `json:"eta_ms"`
}

// ToMessage converts stats data to a message
func (s *StatsData) ToMessage() *Message {
	msg := NewMessage(MsgTypeStats)
	msg.SetData("tasks_total", s.TasksTotal)
	msg.SetData("tasks_completed", s.TasksCompleted)
	msg.SetData("tasks_failed", s.TasksFailed)
	msg.SetData("tasks_pending", s.TasksPending)
	msg.SetData("urls_found", s.URLsFound)
	msg.SetData("captcha_count", s.CaptchaCount)
	msg.SetData("block_count", s.BlockCount)
	msg.SetData("proxies_alive", s.ProxiesAlive)
	msg.SetData("proxies_dead", s.ProxiesDead)
	msg.SetData("requests_per_sec", s.RequestsPerSec)
	msg.SetData("elapsed_ms", s.ElapsedMs)
	msg.SetData("eta_ms", s.ETAMs)
	return msg
}

// ProgressData represents progress update
type ProgressData struct {
	Current    int64   `json:"current"`
	Total      int64   `json:"total"`
	Percentage float64 `json:"percentage"`
}

// ToMessage converts progress data to a message
func (p *ProgressData) ToMessage() *Message {
	msg := NewMessage(MsgTypeProgress)
	msg.SetData("current", p.Current)
	msg.SetData("total", p.Total)
	msg.SetData("percentage", p.Percentage)
	return msg
}

// Handler handles IPC communication
type Handler struct {
	reader  *bufio.Reader
	writer  io.Writer
	writeMu sync.Mutex

	// Callbacks
	onInit     func(*InitConfig)
	onTask     func(*TaskData)
	onPause    func()
	onResume   func()
	onShutdown func()
	onGetStats func()

	// State
	running bool
	stopCh  chan struct{}
}

// NewHandler creates a new IPC handler
func NewHandler() *Handler {
	return &Handler{
		reader: bufio.NewReader(os.Stdin),
		writer: os.Stdout,
		stopCh: make(chan struct{}),
	}
}

// NewHandlerWithIO creates a handler with custom IO
func NewHandlerWithIO(reader io.Reader, writer io.Writer) *Handler {
	return &Handler{
		reader: bufio.NewReader(reader),
		writer: writer,
		stopCh: make(chan struct{}),
	}
}

// OnInit sets the init callback
func (h *Handler) OnInit(fn func(*InitConfig)) {
	h.onInit = fn
}

// OnTask sets the task callback
func (h *Handler) OnTask(fn func(*TaskData)) {
	h.onTask = fn
}

// OnPause sets the pause callback
func (h *Handler) OnPause(fn func()) {
	h.onPause = fn
}

// OnResume sets the resume callback
func (h *Handler) OnResume(fn func()) {
	h.onResume = fn
}

// OnShutdown sets the shutdown callback
func (h *Handler) OnShutdown(fn func()) {
	h.onShutdown = fn
}

// OnGetStats sets the get stats callback
func (h *Handler) OnGetStats(fn func()) {
	h.onGetStats = fn
}

// Start starts listening for messages
func (h *Handler) Start() {
	h.running = true

	// Send ready message
	h.SendStatus("ready", "")

	for h.running {
		select {
		case <-h.stopCh:
			return
		default:
			h.readMessage()
		}
	}
}

// Stop stops the handler
func (h *Handler) Stop() {
	h.running = false
	close(h.stopCh)
}

// readMessage reads and processes a single message
func (h *Handler) readMessage() {
	line, err := h.reader.ReadString('\n')
	if err != nil {
		if err != io.EOF {
			h.SendError("read_error", err.Error())
		}
		return
	}

	if line == "" || line == "\n" {
		return
	}

	var msg Message
	if err := json.Unmarshal([]byte(line), &msg); err != nil {
		h.SendError("parse_error", err.Error())
		return
	}

	h.handleMessage(&msg)
}

// handleMessage handles a parsed message
func (h *Handler) handleMessage(msg *Message) {
	switch msg.Type {
	case MsgTypeInit:
		if h.onInit != nil {
			config := ParseInitConfig(msg)
			h.onInit(config)
		}

	case MsgTypeTask:
		if h.onTask != nil {
			task := ParseTaskData(msg)
			h.onTask(task)
		}

	case MsgTypeTaskBatch:
		if h.onTask != nil {
			// Handle batch of tasks
			if tasks, ok := msg.Data["tasks"].([]any); ok {
				for _, t := range tasks {
					if taskMap, ok := t.(map[string]any); ok {
						task := &TaskData{
							ID:   fmt.Sprintf("%v", taskMap["id"]),
							Dork: fmt.Sprintf("%v", taskMap["dork"]),
						}
						if page, ok := taskMap["page"].(float64); ok {
							task.Page = int(page)
						}
						h.onTask(task)
					}
				}
			}
		}

	case MsgTypePause:
		if h.onPause != nil {
			h.onPause()
		}
		h.SendStatus("paused", "")

	case MsgTypeResume:
		if h.onResume != nil {
			h.onResume()
		}
		h.SendStatus("resumed", "")

	case MsgTypeShutdown:
		if h.onShutdown != nil {
			h.onShutdown()
		}
		h.SendStatus("shutdown", "")
		h.Stop()

	case MsgTypeGetStats:
		if h.onGetStats != nil {
			h.onGetStats()
		}

	default:
		h.SendError("unknown_type", fmt.Sprintf("unknown message type: %s", msg.Type))
	}
}

// Send sends a message
func (h *Handler) Send(msg *Message) error {
	h.writeMu.Lock()
	defer h.writeMu.Unlock()

	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	_, err = fmt.Fprintln(h.writer, string(data))
	return err
}

// SendStatus sends a status message
func (h *Handler) SendStatus(status string, message string) error {
	msg := NewMessage(MsgTypeStatus)
	msg.SetData("status", status)
	if message != "" {
		msg.SetData("message", message)
	}
	return h.Send(msg)
}

// SendError sends an error message
func (h *Handler) SendError(code string, message string) error {
	msg := NewMessage(MsgTypeError)
	msg.SetData("code", code)
	msg.SetData("message", message)
	return h.Send(msg)
}

// SendResult sends a result message
func (h *Handler) SendResult(result *ResultData) error {
	return h.Send(result.ToMessage())
}

// SendStats sends a stats message
func (h *Handler) SendStats(stats *StatsData) error {
	return h.Send(stats.ToMessage())
}

// SendProgress sends a progress message
func (h *Handler) SendProgress(progress *ProgressData) error {
	return h.Send(progress.ToMessage())
}

// SendLog sends a log message
func (h *Handler) SendLog(level string, message string) error {
	msg := NewMessage(MsgTypeLog)
	msg.SetData("level", level)
	msg.SetData("message", message)
	return h.Send(msg)
}

// SendProxyInfo sends proxy information
func (h *Handler) SendProxyInfo(alive, dead, quarantined int) error {
	msg := NewMessage(MsgTypeProxyInfo)
	msg.SetData("alive", alive)
	msg.SetData("dead", dead)
	msg.SetData("quarantined", quarantined)
	msg.SetData("total", alive+dead+quarantined)
	return h.Send(msg)
}
