package protocol

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestNewMessage(t *testing.T) {
	msg := NewMessage(MsgTypeStatus)

	if msg.Type != MsgTypeStatus {
		t.Errorf("Type = %q, want %q", msg.Type, MsgTypeStatus)
	}

	if msg.Timestamp == 0 {
		t.Error("Timestamp should be set")
	}

	if msg.Data == nil {
		t.Error("Data should be initialized")
	}
}

func TestMessageSetData(t *testing.T) {
	msg := NewMessage(MsgTypeStatus)

	msg.SetData("key1", "value1")
	msg.SetData("key2", 123)
	msg.SetData("key3", true)

	if msg.GetString("key1") != "value1" {
		t.Errorf("GetString(key1) = %q, want %q", msg.GetString("key1"), "value1")
	}

	if msg.GetInt("key2") != 123 {
		t.Errorf("GetInt(key2) = %d, want %d", msg.GetInt("key2"), 123)
	}

	if msg.GetBool("key3") != true {
		t.Errorf("GetBool(key3) = %v, want %v", msg.GetBool("key3"), true)
	}
}

func TestMessageGetStringMissing(t *testing.T) {
	msg := NewMessage(MsgTypeStatus)

	if msg.GetString("nonexistent") != "" {
		t.Error("GetString should return empty string for missing key")
	}
}

func TestMessageGetIntMissing(t *testing.T) {
	msg := NewMessage(MsgTypeStatus)

	if msg.GetInt("nonexistent") != 0 {
		t.Error("GetInt should return 0 for missing key")
	}
}

func TestMessageGetIntFromFloat(t *testing.T) {
	msg := NewMessage(MsgTypeStatus)
	msg.Data["float_val"] = 123.0

	if msg.GetInt("float_val") != 123 {
		t.Errorf("GetInt from float = %d, want 123", msg.GetInt("float_val"))
	}
}

func TestMessageGetFloat(t *testing.T) {
	msg := NewMessage(MsgTypeStatus)
	msg.SetData("float_val", 123.456)

	val := msg.GetFloat("float_val")
	if val < 123.45 || val > 123.46 {
		t.Errorf("GetFloat = %v, want ~123.456", val)
	}
}

func TestMessageGetBoolMissing(t *testing.T) {
	msg := NewMessage(MsgTypeStatus)

	if msg.GetBool("nonexistent") != false {
		t.Error("GetBool should return false for missing key")
	}
}

func TestMessageGetStringSlice(t *testing.T) {
	msg := NewMessage(MsgTypeStatus)
	msg.Data["urls"] = []any{"url1", "url2", "url3"}

	urls := msg.GetStringSlice("urls")
	if len(urls) != 3 {
		t.Errorf("GetStringSlice length = %d, want 3", len(urls))
	}

	if urls[0] != "url1" {
		t.Errorf("urls[0] = %q, want %q", urls[0], "url1")
	}
}

func TestMessageGetStringSliceMissing(t *testing.T) {
	msg := NewMessage(MsgTypeStatus)

	urls := msg.GetStringSlice("nonexistent")
	if urls != nil {
		t.Error("GetStringSlice should return nil for missing key")
	}
}

func TestParseInitConfig(t *testing.T) {
	msg := NewMessage(MsgTypeInit)
	msg.SetData("workers", 20)
	msg.SetData("timeout", 30000)
	msg.SetData("base_delay", 8000)
	msg.SetData("min_delay", 3000)
	msg.SetData("max_delay", 15000)
	msg.SetData("max_retries", 5)
	msg.SetData("results_per_page", 50)
	msg.SetData("proxy_file", "/path/to/proxies.txt")

	config := ParseInitConfig(msg)

	if config.Workers != 20 {
		t.Errorf("Workers = %d, want 20", config.Workers)
	}

	if config.Timeout != 30*time.Second {
		t.Errorf("Timeout = %v, want 30s", config.Timeout)
	}

	if config.MaxRetries != 5 {
		t.Errorf("MaxRetries = %d, want 5", config.MaxRetries)
	}

	if config.ProxyFile != "/path/to/proxies.txt" {
		t.Errorf("ProxyFile = %q", config.ProxyFile)
	}
}

func TestParseInitConfigDefaults(t *testing.T) {
	msg := NewMessage(MsgTypeInit)

	config := ParseInitConfig(msg)

	if config.Workers != 10 {
		t.Errorf("default Workers = %d, want 10", config.Workers)
	}

	if config.Timeout != 30*time.Second {
		t.Errorf("default Timeout = %v, want 30s", config.Timeout)
	}

	if config.MaxRetries != 3 {
		t.Errorf("default MaxRetries = %d, want 3", config.MaxRetries)
	}

	if config.ResultsPerPage != 100 {
		t.Errorf("default ResultsPerPage = %d, want 100", config.ResultsPerPage)
	}
}

func TestParseTaskData(t *testing.T) {
	msg := NewMessage(MsgTypeTask)
	msg.SetData("task_id", "task_001")
	msg.SetData("dork", "inurl:admin")
	msg.SetData("page", 0)

	task := ParseTaskData(msg)

	if task.ID != "task_001" {
		t.Errorf("ID = %q, want %q", task.ID, "task_001")
	}

	if task.Dork != "inurl:admin" {
		t.Errorf("Dork = %q, want %q", task.Dork, "inurl:admin")
	}

	if task.Page != 0 {
		t.Errorf("Page = %d, want 0", task.Page)
	}
}

func TestResultDataToMessage(t *testing.T) {
	result := &ResultData{
		TaskID:   "task_001",
		Dork:     "inurl:admin",
		URLs:     []string{"https://example.com/admin", "https://test.org/admin"},
		Status:   "success",
		ProxyID:  "proxy_001",
		Duration: 1500,
	}

	msg := result.ToMessage()

	if msg.Type != MsgTypeResult {
		t.Errorf("Type = %q, want %q", msg.Type, MsgTypeResult)
	}

	if msg.GetString("task_id") != "task_001" {
		t.Errorf("task_id = %q", msg.GetString("task_id"))
	}

	if msg.GetString("status") != "success" {
		t.Errorf("status = %q", msg.GetString("status"))
	}
}

func TestResultDataWithError(t *testing.T) {
	result := &ResultData{
		TaskID: "task_001",
		Dork:   "inurl:admin",
		Status: "error",
		Error:  "connection timeout",
	}

	msg := result.ToMessage()

	if msg.GetString("error") != "connection timeout" {
		t.Errorf("error = %q", msg.GetString("error"))
	}
}

func TestStatsDataToMessage(t *testing.T) {
	stats := &StatsData{
		TasksTotal:     1000,
		TasksCompleted: 500,
		TasksFailed:    10,
		TasksPending:   490,
		URLsFound:      15000,
		CaptchaCount:   5,
		BlockCount:     2,
		ProxiesAlive:   150,
		ProxiesDead:    10,
		RequestsPerSec: 25.5,
		ElapsedMs:      120000,
		ETAMs:          120000,
	}

	msg := stats.ToMessage()

	if msg.Type != MsgTypeStats {
		t.Errorf("Type = %q, want %q", msg.Type, MsgTypeStats)
	}

	if msg.GetInt("tasks_total") != 1000 {
		t.Errorf("tasks_total = %d", msg.GetInt("tasks_total"))
	}

	if msg.GetFloat("requests_per_sec") < 25.4 || msg.GetFloat("requests_per_sec") > 25.6 {
		t.Errorf("requests_per_sec = %v", msg.GetFloat("requests_per_sec"))
	}
}

func TestProgressDataToMessage(t *testing.T) {
	progress := &ProgressData{
		Current:    500,
		Total:      1000,
		Percentage: 50.0,
	}

	msg := progress.ToMessage()

	if msg.Type != MsgTypeProgress {
		t.Errorf("Type = %q, want %q", msg.Type, MsgTypeProgress)
	}

	if msg.GetInt("current") != 500 {
		t.Errorf("current = %d", msg.GetInt("current"))
	}

	if msg.GetFloat("percentage") != 50.0 {
		t.Errorf("percentage = %v", msg.GetFloat("percentage"))
	}
}

func TestHandlerSend(t *testing.T) {
	var buf bytes.Buffer
	h := NewHandlerWithIO(strings.NewReader(""), &buf)

	msg := NewMessage(MsgTypeStatus)
	msg.SetData("status", "ready")

	err := h.Send(msg)
	if err != nil {
		t.Fatalf("Send failed: %v", err)
	}

	output := buf.String()
	if !strings.Contains(output, `"type":"status"`) {
		t.Errorf("output should contain type:status, got: %s", output)
	}

	if !strings.Contains(output, `"status":"ready"`) {
		t.Errorf("output should contain status:ready, got: %s", output)
	}
}

func TestHandlerSendStatus(t *testing.T) {
	var buf bytes.Buffer
	h := NewHandlerWithIO(strings.NewReader(""), &buf)

	err := h.SendStatus("initialized", "Worker ready")
	if err != nil {
		t.Fatalf("SendStatus failed: %v", err)
	}

	output := buf.String()
	if !strings.Contains(output, `"status":"initialized"`) {
		t.Errorf("output missing status, got: %s", output)
	}
}

func TestHandlerSendError(t *testing.T) {
	var buf bytes.Buffer
	h := NewHandlerWithIO(strings.NewReader(""), &buf)

	err := h.SendError("parse_error", "Invalid JSON")
	if err != nil {
		t.Fatalf("SendError failed: %v", err)
	}

	output := buf.String()
	if !strings.Contains(output, `"type":"error"`) {
		t.Errorf("output missing type:error, got: %s", output)
	}

	if !strings.Contains(output, `"code":"parse_error"`) {
		t.Errorf("output missing code, got: %s", output)
	}
}

func TestHandlerSendResult(t *testing.T) {
	var buf bytes.Buffer
	h := NewHandlerWithIO(strings.NewReader(""), &buf)

	result := &ResultData{
		TaskID:   "task_001",
		Dork:     "inurl:admin",
		URLs:     []string{"https://example.com"},
		Status:   "success",
		Duration: 1000,
	}

	err := h.SendResult(result)
	if err != nil {
		t.Fatalf("SendResult failed: %v", err)
	}

	output := buf.String()
	if !strings.Contains(output, `"type":"result"`) {
		t.Errorf("output missing type:result, got: %s", output)
	}
}

func TestHandlerSendStats(t *testing.T) {
	var buf bytes.Buffer
	h := NewHandlerWithIO(strings.NewReader(""), &buf)

	stats := &StatsData{
		TasksTotal:     100,
		TasksCompleted: 50,
	}

	err := h.SendStats(stats)
	if err != nil {
		t.Fatalf("SendStats failed: %v", err)
	}

	output := buf.String()
	if !strings.Contains(output, `"type":"stats"`) {
		t.Errorf("output missing type:stats, got: %s", output)
	}
}

func TestHandlerSendProgress(t *testing.T) {
	var buf bytes.Buffer
	h := NewHandlerWithIO(strings.NewReader(""), &buf)

	progress := &ProgressData{
		Current:    50,
		Total:      100,
		Percentage: 50.0,
	}

	err := h.SendProgress(progress)
	if err != nil {
		t.Fatalf("SendProgress failed: %v", err)
	}

	output := buf.String()
	if !strings.Contains(output, `"type":"progress"`) {
		t.Errorf("output missing type:progress, got: %s", output)
	}
}

func TestHandlerSendLog(t *testing.T) {
	var buf bytes.Buffer
	h := NewHandlerWithIO(strings.NewReader(""), &buf)

	err := h.SendLog("info", "Processing started")
	if err != nil {
		t.Fatalf("SendLog failed: %v", err)
	}

	output := buf.String()
	if !strings.Contains(output, `"type":"log"`) {
		t.Errorf("output missing type:log, got: %s", output)
	}

	if !strings.Contains(output, `"level":"info"`) {
		t.Errorf("output missing level, got: %s", output)
	}
}

func TestHandlerSendProxyInfo(t *testing.T) {
	var buf bytes.Buffer
	h := NewHandlerWithIO(strings.NewReader(""), &buf)

	err := h.SendProxyInfo(100, 10, 5)
	if err != nil {
		t.Fatalf("SendProxyInfo failed: %v", err)
	}

	output := buf.String()
	if !strings.Contains(output, `"type":"proxy_info"`) {
		t.Errorf("output missing type:proxy_info, got: %s", output)
	}

	if !strings.Contains(output, `"total":115`) {
		t.Errorf("output missing total, got: %s", output)
	}
}

func TestHandlerCallbacks(t *testing.T) {
	initCalled := false
	taskCalled := false
	pauseCalled := false
	resumeCalled := false

	input := `{"type":"init","ts":1234567890,"data":{"workers":10}}
{"type":"task","ts":1234567890,"data":{"task_id":"1","dork":"test"}}
{"type":"pause","ts":1234567890}
{"type":"resume","ts":1234567890}
`

	var buf bytes.Buffer
	h := NewHandlerWithIO(strings.NewReader(input), &buf)

	h.OnInit(func(config *InitConfig) {
		initCalled = true
		if config.Workers != 10 {
			t.Errorf("config.Workers = %d, want 10", config.Workers)
		}
	})

	h.OnTask(func(task *TaskData) {
		taskCalled = true
		if task.Dork != "test" {
			t.Errorf("task.Dork = %q, want %q", task.Dork, "test")
		}
	})

	h.OnPause(func() {
		pauseCalled = true
	})

	h.OnResume(func() {
		resumeCalled = true
	})

	// Process messages
	for i := 0; i < 4; i++ {
		h.readMessage()
	}

	if !initCalled {
		t.Error("init callback not called")
	}

	if !taskCalled {
		t.Error("task callback not called")
	}

	if !pauseCalled {
		t.Error("pause callback not called")
	}

	if !resumeCalled {
		t.Error("resume callback not called")
	}
}

func TestHandlerTaskBatch(t *testing.T) {
	tasksReceived := 0

	input := `{"type":"task_batch","ts":1234567890,"data":{"tasks":[{"id":"1","dork":"test1"},{"id":"2","dork":"test2"},{"id":"3","dork":"test3"}]}}
`

	var buf bytes.Buffer
	h := NewHandlerWithIO(strings.NewReader(input), &buf)

	h.OnTask(func(task *TaskData) {
		tasksReceived++
	})

	h.readMessage()

	if tasksReceived != 3 {
		t.Errorf("tasksReceived = %d, want 3", tasksReceived)
	}
}

func TestHandlerShutdown(t *testing.T) {
	shutdownCalled := false

	input := `{"type":"shutdown","ts":1234567890}
`

	var buf bytes.Buffer
	h := NewHandlerWithIO(strings.NewReader(input), &buf)

	h.OnShutdown(func() {
		shutdownCalled = true
	})

	h.readMessage()

	if !shutdownCalled {
		t.Error("shutdown callback not called")
	}

	output := buf.String()
	if !strings.Contains(output, `"status":"shutdown"`) {
		t.Errorf("output should contain shutdown status, got: %s", output)
	}
}

func TestHandlerUnknownType(t *testing.T) {
	input := `{"type":"unknown_type","ts":1234567890}
`

	var buf bytes.Buffer
	h := NewHandlerWithIO(strings.NewReader(input), &buf)

	h.readMessage()

	output := buf.String()
	if !strings.Contains(output, `"type":"error"`) {
		t.Errorf("should send error for unknown type, got: %s", output)
	}
}

func TestHandlerInvalidJSON(t *testing.T) {
	input := `{invalid json}
`

	var buf bytes.Buffer
	h := NewHandlerWithIO(strings.NewReader(input), &buf)

	h.readMessage()

	output := buf.String()
	if !strings.Contains(output, `"type":"error"`) {
		t.Errorf("should send error for invalid JSON, got: %s", output)
	}

	if !strings.Contains(output, `"code":"parse_error"`) {
		t.Errorf("error code should be parse_error, got: %s", output)
	}
}

func TestHandlerEmptyLine(t *testing.T) {
	input := `

`

	var buf bytes.Buffer
	h := NewHandlerWithIO(strings.NewReader(input), &buf)

	h.readMessage()

	// Should not produce any output for empty lines
	if buf.Len() > 0 {
		t.Errorf("should not produce output for empty line, got: %s", buf.String())
	}
}

func TestMessageJSONRoundtrip(t *testing.T) {
	original := NewMessage(MsgTypeResult)
	original.SetData("task_id", "task_001")
	original.SetData("urls", []string{"url1", "url2"})
	original.SetData("count", 42)

	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	var parsed Message
	err = json.Unmarshal(data, &parsed)
	if err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}

	if parsed.Type != original.Type {
		t.Errorf("Type mismatch: %q != %q", parsed.Type, original.Type)
	}

	if parsed.GetString("task_id") != "task_001" {
		t.Errorf("task_id mismatch: %q", parsed.GetString("task_id"))
	}
}

func TestMessageTypes(t *testing.T) {
	types := []MessageType{
		MsgTypeInit,
		MsgTypeTask,
		MsgTypeTaskBatch,
		MsgTypePause,
		MsgTypeResume,
		MsgTypeShutdown,
		MsgTypeGetStats,
		MsgTypeStatus,
		MsgTypeResult,
		MsgTypeStats,
		MsgTypeError,
		MsgTypeLog,
		MsgTypeProgress,
		MsgTypeProxyInfo,
	}

	seen := make(map[MessageType]bool)
	for _, mt := range types {
		if seen[mt] {
			t.Errorf("duplicate message type: %s", mt)
		}
		seen[mt] = true

		if mt == "" {
			t.Error("message type should not be empty")
		}
	}
}
