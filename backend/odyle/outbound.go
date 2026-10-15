package odyle

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Every call to PLAYNC, Discord and GitHub goes through send. One transport keeps
// connections between calls and takes proxies from the environment (HTTPS_PROXY). Each
// call caps the answer it reads and names the hosts a redirect may lead to, and its
// errors name the method and host but never the URL, which can carry a webhook token
// or a character name.

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

// call is one outbound request.
type call struct {
	method, url string
	headers     map[string]string
	payload     []byte
	timeout     time.Duration
	// limit is the largest answer read, in bytes; a larger one is an error.
	limit int64
	// redirects are the hosts a redirect may lead to, "*.example.com" for any subdomain.
	// Without any, or to another host, a redirect is the answer itself.
	redirects []string
}

var transport = func() *http.Transport {
	t := http.DefaultTransport.(*http.Transport).Clone()
	t.MaxIdleConnsPerHost = 4
	return t
}()

// send makes one outbound request.
func send(c call) (response, error) {
	ctx, cancel := context.WithTimeout(context.Background(), c.timeout)
	defer cancel()
	var reader io.Reader
	if c.payload != nil {
		reader = bytes.NewReader(c.payload)
	}
	req, err := http.NewRequestWithContext(ctx, c.method, c.url, reader)
	if err != nil {
		return response{}, errors.New(c.method + ": the address is not valid")
	}
	for k, v := range c.headers {
		req.Header.Set(k, v)
	}
	client := &http.Client{Transport: transport, CheckRedirect: func(next *http.Request, via []*http.Request) error {
		if len(via) >= 5 || !allowedRedirect(next.URL, req.URL, c.redirects) {
			return http.ErrUseLastResponse
		}
		return nil
	}}
	res, err := client.Do(req)
	if err != nil {
		return response{}, failed(c.method, req.URL, err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, c.limit+1))
	if err != nil {
		return response{}, failed(c.method, req.URL, err)
	}
	if int64(len(raw)) > c.limit {
		return response{}, fmt.Errorf("%s %s: the answer is larger than %d bytes", c.method, req.URL.Host, c.limit)
	}
	return response{status: res.StatusCode, header: res.Header, body: raw}, nil
}

// allowedRedirect reports whether a redirect may go to target: one of the hosts, over
// HTTPS or the scheme of the first request (the tests' stand-ins speak plain HTTP).
func allowedRedirect(target, first *url.URL, hosts []string) bool {
	if target.Scheme != "https" && target.Scheme != first.Scheme {
		return false
	}
	host := strings.ToLower(target.Hostname())
	for _, allowed := range hosts {
		suffix, wildcard := strings.CutPrefix(allowed, "*.")
		if host == allowed || wildcard && strings.HasSuffix(host, "."+suffix) {
			return true
		}
	}
	return false
}

// failed is a transport error without the URL: "GET api.github.com: <reason>".
func failed(method string, u *url.URL, err error) error {
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		err = urlErr.Err
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return fmt.Errorf("%s %s: no answer in time", method, u.Host)
	}
	return fmt.Errorf("%s %s: %v", method, u.Host, err)
}

// retryAfter is how long an answer asks to wait (Retry-After in seconds or as a date,
// or Discord's retry_after in the body), or 0.
func retryAfter(r response) time.Duration {
	if v := strings.TrimSpace(r.header.Get("Retry-After")); v != "" {
		if seconds, err := strconv.ParseFloat(v, 64); err == nil && seconds >= 0 {
			return time.Duration(seconds * float64(time.Second))
		}
		if at, err := http.ParseTime(v); err == nil {
			return max(0, time.Until(at))
		}
	}
	if body, ok := r.json().(map[string]any); ok {
		if seconds, ok := body["retry_after"].(float64); ok && seconds >= 0 {
			return time.Duration(seconds * float64(time.Second))
		}
	}
	return 0
}

const userAgent = "Odyle (AION 2 party dashboard)"
