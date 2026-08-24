package sidecar

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestParseHandshake(t *testing.T) {
	valid := []byte(`{"schema":1,"host":"127.0.0.1","port":43123,"token":"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO"}` + "\n")
	value, err := parseHandshake(valid)
	if err != nil {
		t.Fatalf("parse valid handshake: %v", err)
	}
	if value.Port != 43123 {
		t.Fatalf("port = %d", value.Port)
	}

	for name, input := range map[string]string{
		"schema": `{"schema":2,"host":"127.0.0.1","port":1,"token":"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO"}`,
		"host":   `{"schema":1,"host":"0.0.0.0","port":1,"token":"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO"}`,
		"port":   `{"schema":1,"host":"127.0.0.1","port":0,"token":"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO"}`,
		"token":  `{"schema":1,"host":"127.0.0.1","port":1,"token":"short"}`,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := parseHandshake([]byte(input)); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestValidateEndpoint(t *testing.T) {
	for _, endpoint := range []string{"/v1/capabilities", "/v1/tasks/abc/events?after=3"} {
		if err := validateEndpoint(endpoint); err != nil {
			t.Fatalf("valid endpoint %q: %v", endpoint, err)
		}
	}
	for _, endpoint := range []string{"https://example.com/v1/tasks", "//example.com/v1/tasks", "/v1/../secret", "/health"} {
		if err := validateEndpoint(endpoint); err == nil {
			t.Fatalf("expected endpoint %q to fail", endpoint)
		}
	}
}

func TestDoJSONKeepsTokenInBackendAndPreservesErrors(t *testing.T) {
	const token = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO"
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer "+token {
			http.Error(response, "missing token", http.StatusUnauthorized)
			return
		}
		if request.URL.Path == "/v1/fail" {
			response.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(response).Encode(map[string]any{
				"error": map[string]string{"code": "invalid_state", "message": "cannot resume"},
			})
			return
		}
		_ = json.NewEncoder(response).Encode(map[string]any{"provider": "local"})
	}))
	defer server.Close()
	if !loopbackURL(server.URL) {
		t.Fatalf("httptest URL is not loopback: %s", server.URL)
	}

	manager := New(Config{})
	manager.process = &processState{baseURL: server.URL, token: token}
	var capabilities map[string]any
	if err := manager.DoJSON(context.Background(), http.MethodGet, "/v1/capabilities", nil, &capabilities); err != nil {
		t.Fatalf("capabilities: %v", err)
	}
	if capabilities["provider"] != "local" {
		t.Fatalf("provider = %#v", capabilities["provider"])
	}
	err := manager.DoJSON(context.Background(), http.MethodPost, "/v1/fail", map[string]any{}, nil)
	var httpErr *HTTPError
	if !errors.As(err, &httpErr) || httpErr.Code != "invalid_state" || httpErr.StatusCode != http.StatusConflict {
		t.Fatalf("error = %#v", err)
	}
	if strings.Contains(manager.Snapshot().BaseURL, token) {
		t.Fatal("snapshot exposed the session token")
	}
}

func TestManagerStartsAndStopsChildProcess(t *testing.T) {
	manager := New(Config{
		Executable: os.Args[0],
		Args:       []string{"-test.run=TestSidecarHelperProcess"},
		Environment: []string{
			"FINOKA_SIDECAR_HELPER=1",
		},
		StartupTimeout: 5 * time.Second,
	})

	started, err := manager.Start(context.Background())
	if err != nil {
		t.Fatalf("start helper sidecar: %v", err)
	}
	if !started.Running || started.PID <= 0 || started.BaseURL != "http://127.0.0.1:43123" {
		t.Fatalf("unexpected running snapshot: %#v", started)
	}

	stopContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := manager.Stop(stopContext); err != nil {
		t.Fatalf("stop helper sidecar: %v", err)
	}
	if stopped := manager.Snapshot(); stopped.Running {
		t.Fatalf("sidecar is still running: %#v", stopped)
	}
}

func TestSidecarHelperProcess(t *testing.T) {
	if os.Getenv("FINOKA_SIDECAR_HELPER") != "1" {
		return
	}
	fmt.Println(`{"schema":1,"host":"127.0.0.1","port":43123,"token":"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO"}`)
	select {}
}
