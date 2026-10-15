package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCheckHealth(t *testing.T) {
	status := http.StatusOK
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/health" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(status)
	}))
	defer server.Close()
	if err := checkHealth(server.URL + "/api/health"); err != nil {
		t.Fatalf("a healthy server: %v", err)
	}
	status = http.StatusServiceUnavailable
	if err := checkHealth(server.URL + "/api/health"); err == nil || !strings.Contains(err.Error(), "503") {
		t.Fatalf("an unhealthy server: %v", err)
	}
	server.Close()
	if err := checkHealth(server.URL + "/api/health"); err == nil {
		t.Fatal("a stopped server passed")
	}
}
