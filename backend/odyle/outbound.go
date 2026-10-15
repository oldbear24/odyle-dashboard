package odyle

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"
)

// response is what the PLAYNC, Discord and GitHub calls need from an answer.
type response struct {
	status int
	header http.Header
	body   []byte
}

// json is the body as a JSON object (or list), or nil when it is neither.
func (r response) json() any {
	if len(r.body) == 0 {
		return nil
	}
	var v any
	if json.Unmarshal(r.body, &v) != nil {
		return nil
	}
	switch v.(type) {
	case map[string]any, []any:
		return v
	}
	return nil
}

// send makes one outbound request. Proxies come from the environment (HTTPS_PROXY).
func send(method, url string, headers map[string]string, payload []byte, timeout time.Duration) (response, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	var reader io.Reader
	if payload != nil {
		reader = bytes.NewReader(payload)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, reader)
	if err != nil {
		return response{}, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return response{}, err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return response{}, err
	}
	return response{status: res.StatusCode, header: res.Header, body: raw}, nil
}

const userAgent = "Odyle (AION 2 party dashboard)"
