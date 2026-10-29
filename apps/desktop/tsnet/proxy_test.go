package main

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"io"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/net/websocket"
)

func trustedServer(t *testing.T, handler http.Handler) (*httptest.Server, *x509.CertPool) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	certificate := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "gr.gr-iot.cn"},
		DNSNames: []string{"gr.gr-iot.cn"}, NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IsCA: true, BasicConstraintsValid: true}
	der, err := x509.CreateCertificate(rand.Reader, certificate, certificate, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AddCert(parsed)
	server := httptest.NewUnstartedServer(handler)
	server.Config.ErrorLog = log.New(io.Discard, "", 0)
	server.TLS = &tls.Config{Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}}, MinVersion: tls.VersionTLS12}
	server.StartTLS()
	t.Cleanup(server.Close)
	return server, roots
}

func TestPrivateHTTPSAndWSSPreserveTLSNamesAndPorts(t *testing.T) {
	websocketHandler := websocket.Handler(func(conn *websocket.Conn) {
		defer conn.Close()
		var message string
		if err := websocket.Message.Receive(conn, &message); err != nil {
			t.Error(err)
			return
		}
		if err := websocket.Message.Send(conn, "echo:"+message); err != nil {
			t.Error(err)
		}
	})
	backend, roots := trustedServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/socket" {
			if r.Host != "gr.gr-iot.cn:3082" || r.URL.RawQuery != "channel=test" {
				t.Error("WSS authority or path changed")
			}
			websocketHandler.ServeHTTP(w, r)
			return
		}
		if r.Host != "gr.gr-iot.cn:3081" || r.URL.RequestURI() != "/private?keep=1" {
			t.Error("HTTPS authority or path changed")
		}
		_, _ = io.WriteString(w, "private page")
	}))
	backendURL, _ := url.Parse(backend.URL)
	private := func(ctx context.Context, network, address string) (net.Conn, error) {
		if address != "100.64.0.6:3081" && address != "100.64.0.6:3082" {
			t.Errorf("unexpected private destination %q", address)
		}
		return (&net.Dialer{}).DialContext(ctx, network, backendURL.Host)
	}
	proxy, err := newOutboundProxy([]route{{Host: "gr.gr-iot.cn", Address: "100.64.0.6"}}, private)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(proxy)
	t.Cleanup(server.Close)
	proxyURL, _ := url.Parse(server.URL)
	transport := &http.Transport{Proxy: http.ProxyURL(proxyURL), TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}}
	t.Cleanup(transport.CloseIdleConnections)
	response, err := (&http.Client{Transport: transport}).Get("https://gr.gr-iot.cn:3081/private?keep=1")
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil || string(body) != "private page" {
		t.Fatalf("HTTPS response: %q, %v", body, err)
	}

	connection, err := net.Dial("tcp", proxyURL.Host)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	request := &http.Request{Method: http.MethodConnect, URL: &url.URL{Opaque: "gr.gr-iot.cn:3082"}, Host: "gr.gr-iot.cn:3082", Header: make(http.Header)}
	if err := request.Write(connection); err != nil {
		t.Fatal(err)
	}
	reader := bufio.NewReader(connection)
	tunnel, err := http.ReadResponse(reader, request)
	if err != nil || tunnel.StatusCode != 200 {
		t.Fatalf("CONNECT failed: %v", err)
	}
	secured := tls.Client(&bufferedConn{Conn: connection, reader: reader}, &tls.Config{RootCAs: roots, ServerName: "gr.gr-iot.cn", MinVersion: tls.VersionTLS12})
	if err := secured.Handshake(); err != nil {
		t.Fatal(err)
	}
	config, err := websocket.NewConfig("wss://gr.gr-iot.cn:3082/socket?channel=test", "https://gr.gr-iot.cn:3081")
	if err != nil {
		t.Fatal(err)
	}
	socket, err := websocket.NewClient(config, secured)
	if err != nil {
		t.Fatal(err)
	}
	defer socket.Close()
	if err := websocket.Message.Send(socket, "ping"); err != nil {
		t.Fatal(err)
	}
	var message string
	if err := websocket.Message.Receive(socket, &message); err != nil || message != "echo:ping" {
		t.Fatalf("WSS round trip: %q, %v", message, err)
	}

	wrong := transport.Clone()
	wrong.TLSClientConfig = &tls.Config{RootCAs: roots, ServerName: "wrong.invalid", MinVersion: tls.VersionTLS12}
	defer wrong.CloseIdleConnections()
	if _, err := (&http.Client{Transport: wrong}).Get("https://gr.gr-iot.cn:3081/private"); err == nil {
		t.Fatal("a mismatched TLS certificate was accepted")
	}
}

func TestInboundKeepsDSHAuthenticationAndRejectsOtherOrigins(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("token") != "owner-token" && r.Header.Get("Cookie") != "dsh=authorized" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.URL.Path == "/origin" && r.Header.Get("Origin") != "http://"+r.Host {
			t.Error("owned Origin was not adapted")
		}
		_, _ = io.WriteString(w, r.URL.RequestURI())
	}))
	defer backend.Close()
	local, _ := url.Parse(backend.URL)
	var target atomic.Pointer[url.URL]
	target.Store(local)
	proxy := httptest.NewServer(newInboundProxy(&target, []string{"dsh.example.ts.net", "100.64.0.2"}))
	defer proxy.Close()
	for _, test := range []struct {
		host, origin, path, cookie string
		status                     int
	}{
		{"dsh.example.ts.net", "", "/", "", 401},
		{"dsh.example.ts.net", "", "/?token=owner-token", "", 200},
		{"dsh.example.ts.net", "http://dsh.example.ts.net", "/origin", "dsh=authorized", 200},
		{"dsh.example.ts.net", "http://attacker.invalid", "/?token=owner-token", "", 403},
		{"attacker.invalid", "", "/?token=owner-token", "", 403},
		{"dsh.example.ts.net", "null", "/?token=owner-token", "", 403},
	} {
		request, _ := http.NewRequest(http.MethodGet, proxy.URL+test.path, nil)
		request.Host = test.host
		request.Header.Set("Origin", test.origin)
		request.Header.Set("Cookie", test.cookie)
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != test.status {
			t.Errorf("%s %s: got %d, want %d", test.host, test.origin, response.StatusCode, test.status)
		}
	}
	target.Store(nil)
	request, _ := http.NewRequest(http.MethodGet, proxy.URL+"/?token=owner-token", nil)
	request.Host = "dsh.example.ts.net"
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 503 {
		t.Fatal("withdrawn workspace was still published")
	}
}

func TestOrdinaryHTTPDoesNotRequireTailnet(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, "public") }))
	defer backend.Close()
	proxy, _ := newOutboundProxy(nil, func(context.Context, string, string) (net.Conn, error) {
		t.Error("public traffic used tsnet")
		return nil, net.ErrClosed
	})
	server := httptest.NewServer(proxy)
	defer server.Close()
	proxyURL, _ := url.Parse(server.URL)
	transport := &http.Transport{Proxy: http.ProxyURL(proxyURL)}
	defer transport.CloseIdleConnections()
	response, err := (&http.Client{Transport: transport}).Get(backend.URL)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if strings.TrimSpace(string(body)) != "public" {
		t.Fatalf("unexpected response: %q", body)
	}
}

func TestConfigurationRejectsNonLocalPublicationAndUnsafeRoutes(t *testing.T) {
	for _, raw := range []string{"http://example.com:3080", "https://127.0.0.1:3080", "http://127.0.0.1:3080/?token=secret"} {
		if _, err := loopbackTarget(raw); err == nil {
			t.Errorf("accepted target %q", raw)
		}
	}
	if _, err := loopbackTarget("http://127.0.0.1:3080"); err != nil {
		t.Fatal(err)
	}
	config := configuration{StateDir: t.TempDir(), Hostname: "dsh-test", ControlURL: "https://headscale.example.com",
		Routes: []route{{Host: "gr.gr-iot.cn", Address: "100.64.0.6"}}}
	if err := validateConfiguration(config); err != nil {
		t.Fatal(err)
	}
	config.Routes[0].Address = "127.0.0.1"
	if validateConfiguration(config) == nil {
		t.Fatal("accepted loopback private mapping")
	}
}
