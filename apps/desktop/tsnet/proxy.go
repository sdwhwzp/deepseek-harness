// HTTP CONNECT keeps the original HTTPS and WSS authority and certificate checks.
package main

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
)

type dialContext func(context.Context, string, string) (net.Conn, error)

func tailnetIP(address net.IP) bool {
	if address == nil {
		return false
	}
	_, ipv4, _ := net.ParseCIDR("100.64.0.0/10")
	_, ipv6, _ := net.ParseCIDR("fd7a:115c:a1e0::/48")
	return ipv4.Contains(address) || ipv6.Contains(address)
}

func loopbackTarget(raw string) (*url.URL, error) {
	target, err := url.Parse(raw)
	if err != nil || target.Scheme != "http" || !net.ParseIP(target.Hostname()).IsLoopback() || target.Port() == "" ||
		target.User != nil || target.RawQuery != "" || target.Fragment != "" || (target.Path != "" && target.Path != "/") {
		return nil, errors.New("invalid local DSH target")
	}
	return target, nil
}

type outboundProxy struct {
	routes    map[string]string
	private   dialContext
	transport *http.Transport
}

func newOutboundProxy(routes []route, private dialContext) (*outboundProxy, error) {
	p := &outboundProxy{routes: make(map[string]string), private: private}
	for _, item := range routes {
		key := strings.ToLower(strings.TrimSuffix(item.Host, "."))
		if _, duplicate := p.routes[key]; duplicate {
			return nil, errors.New("duplicate private-network route")
		}
		p.routes[key] = item.Address
	}
	p.transport = http.DefaultTransport.(*http.Transport).Clone()
	p.transport.DialContext = p.dial
	p.transport.Proxy = func(request *http.Request) (*url.URL, error) {
		if p.privateHost(request.URL.Hostname()) {
			return nil, nil
		}
		return http.ProxyFromEnvironment(request)
	}
	return p, nil
}

func (p *outboundProxy) privateHost(host string) bool {
	_, mapped := p.routes[strings.ToLower(strings.TrimSuffix(host, "."))]
	return mapped || tailnetIP(net.ParseIP(host)) || strings.HasSuffix(strings.ToLower(host), ".ts.net")
}

func (p *outboundProxy) dial(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	if mapped, ok := p.routes[strings.ToLower(strings.TrimSuffix(host, "."))]; ok {
		return p.private(ctx, network, net.JoinHostPort(mapped, port))
	}
	if p.privateHost(host) {
		return p.private(ctx, network, address)
	}
	return (&net.Dialer{}).DialContext(ctx, network, address)
}

// Existing corporate HTTP proxies remain the upstream for ordinary Internet traffic.
func (p *outboundProxy) connect(ctx context.Context, address string) (net.Conn, error) {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	if p.privateHost(host) {
		return p.dial(ctx, "tcp", address)
	}
	upstream, err := http.ProxyFromEnvironment(&http.Request{URL: &url.URL{Scheme: "https", Host: address}})
	if err != nil || upstream == nil {
		return p.dial(ctx, "tcp", address)
	}
	port := upstream.Port()
	if port == "" {
		if upstream.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	conn, err := (&net.Dialer{}).DialContext(ctx, "tcp", net.JoinHostPort(upstream.Hostname(), port))
	if err != nil {
		return nil, err
	}
	if upstream.Scheme == "https" {
		secured := tls.Client(conn, &tls.Config{ServerName: upstream.Hostname(), MinVersion: tls.VersionTLS12})
		if err := secured.HandshakeContext(ctx); err != nil {
			conn.Close()
			return nil, err
		}
		conn = secured
	}
	request := &http.Request{Method: http.MethodConnect, URL: &url.URL{Opaque: address}, Host: address, Header: make(http.Header)}
	if upstream.User != nil {
		password, _ := upstream.User.Password()
		credentials := upstream.User.Username() + ":" + password
		request.Header.Set("Proxy-Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(credentials)))
	}
	if err := request.Write(conn); err != nil {
		conn.Close()
		return nil, err
	}
	reader := bufio.NewReader(conn)
	response, err := http.ReadResponse(reader, request)
	if err != nil || response.StatusCode != http.StatusOK {
		conn.Close()
		return nil, errors.New("upstream proxy refused CONNECT")
	}
	return &bufferedConn{Conn: conn, reader: reader}, nil
}

type bufferedConn struct {
	net.Conn
	reader *bufio.Reader
}

func (c *bufferedConn) Read(buffer []byte) (int, error) { return c.reader.Read(buffer) }

func (p *outboundProxy) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	if request.Method == http.MethodConnect {
		upstream, err := p.connect(request.Context(), request.Host)
		if err != nil {
			http.Error(writer, "Private-network connection unavailable", http.StatusBadGateway)
			return
		}
		defer upstream.Close()
		local, buffered, err := http.NewResponseController(writer).Hijack()
		if err != nil {
			return
		}
		defer local.Close()
		if _, err := buffered.WriteString("HTTP/1.1 200 Connection Established\r\n\r\n"); err != nil {
			return
		}
		if err := buffered.Flush(); err != nil {
			return
		}
		var streams sync.WaitGroup
		streams.Add(2)
		go func() { defer streams.Done(); _, _ = io.Copy(upstream, buffered); upstream.Close(); local.Close() }()
		go func() { defer streams.Done(); _, _ = io.Copy(local, upstream); upstream.Close(); local.Close() }()
		streams.Wait()
		return
	}
	if request.URL.Scheme != "http" || request.URL.Host == "" {
		http.Error(writer, "Expected an absolute HTTP request", http.StatusBadRequest)
		return
	}
	proxy := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.Out.Header.Del("Proxy-Authorization")
			r.Out.Header.Del("Proxy-Connection")
		},
		Transport: p.transport,
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, _ error) {
			http.Error(w, "Network connection unavailable", http.StatusBadGateway)
		},
	}
	proxy.ServeHTTP(writer, request)
}

func newInboundProxy(target *atomic.Pointer[url.URL], hosts []string) http.Handler {
	allowed := make(map[string]bool)
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	for _, host := range hosts {
		allowed[strings.ToLower(host)] = true
	}
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		host := request.Host
		if parsed, port, err := net.SplitHostPort(host); err == nil {
			if port != "80" {
				http.Error(writer, "Forbidden", http.StatusForbidden)
				return
			}
			host = parsed
		}
		if !allowed[strings.ToLower(strings.TrimSuffix(host, "."))] {
			http.Error(writer, "Forbidden", http.StatusForbidden)
			return
		}
		origin := request.Header.Get("Origin")
		if origin != "" {
			parsed, err := url.Parse(origin)
			if err != nil || parsed.Scheme != "http" || !strings.EqualFold(parsed.Host, request.Host) || parsed.User != nil ||
				parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
				http.Error(writer, "Forbidden", http.StatusForbidden)
				return
			}
		}
		backend := target.Load()
		if backend == nil {
			http.Error(writer, "Open the DSH workspace on its desktop first", http.StatusServiceUnavailable)
			return
		}
		proxy := &httputil.ReverseProxy{
			Rewrite: func(r *httputil.ProxyRequest) {
				r.SetURL(backend)
				r.Out.Host = backend.Host
				if origin != "" {
					r.Out.Header.Set("Origin", backend.Scheme+"://"+backend.Host)
				}
			},
			Transport: transport,
			ErrorHandler: func(w http.ResponseWriter, _ *http.Request, _ error) {
				http.Error(w, "DSH is restarting", http.StatusBadGateway)
			},
		}
		proxy.ServeHTTP(writer, request)
	})
}
