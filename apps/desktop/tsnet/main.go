// dsh-tsnet embeds the official userspace Tailscale node without an OS service.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"tailscale.com/ipn"
	"tailscale.com/tsnet"
)

const protocolVersion = 1

var tailscaleVersion = "development"

type route struct {
	Host    string `json:"host"`
	Address string `json:"address"`
}

type configuration struct {
	StateDir   string  `json:"stateDir"`
	Hostname   string  `json:"hostname"`
	ControlURL string  `json:"controlURL"`
	AuthKey    string  `json:"authKey,omitempty"`
	Routes     []route `json:"routes"`
}

type command struct {
	Target   string `json:"target"`
	Revision int    `json:"revision"`
}

type event struct {
	Version  int    `json:"version"`
	State    string `json:"state"`
	URL      string `json:"url,omitempty"`
	ProxyURL string `json:"proxyURL,omitempty"`
	LoginURL string `json:"loginURL,omitempty"`
	Code     string `json:"code,omitempty"`
	Revision int    `json:"revision,omitempty"`
}

type events struct {
	mu     sync.Mutex
	writer io.Writer
}

func (e *events) send(value event) {
	e.mu.Lock()
	defer e.mu.Unlock()
	value.Version = protocolVersion
	_ = json.NewEncoder(e.writer).Encode(value)
}

func validateConfiguration(config configuration) error {
	if !filepath.IsAbs(config.StateDir) || config.Hostname == "" || len(config.Hostname) > 63 {
		return errors.New("invalid state directory or hostname")
	}
	for _, ch := range config.Hostname {
		if !(ch >= 'a' && ch <= 'z' || ch >= '0' && ch <= '9' || ch == '-') {
			return errors.New("invalid hostname")
		}
	}
	control, err := url.Parse(config.ControlURL)
	if err != nil || control.User != nil || control.Host == "" || control.RawQuery != "" || control.Fragment != "" ||
		(control.Scheme != "https" && !(control.Scheme == "http" && net.ParseIP(control.Hostname()).IsLoopback())) {
		return errors.New("invalid control server")
	}
	for _, item := range config.Routes {
		if item.Host == "" || strings.ContainsAny(item.Host, "/:@ \t\r\n") || !tailnetIP(net.ParseIP(item.Address)) {
			return errors.New("invalid private-network route")
		}
	}
	return nil
}

func run(input io.Reader, output io.Writer) error {
	lines := bufio.NewScanner(input)
	lines.Buffer(make([]byte, 4096), 64*1024)
	if !lines.Scan() {
		return errors.New("missing configuration")
	}
	var config configuration
	if err := json.Unmarshal(lines.Bytes(), &config); err != nil {
		return errors.New("invalid configuration JSON")
	}
	if err := validateConfiguration(config); err != nil {
		return err
	}
	if err := os.MkdirAll(config.StateDir, 0700); err != nil {
		return errors.New("state directory unavailable")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	notices := &events{writer: output}
	node := &tsnet.Server{
		Dir: config.StateDir, Hostname: config.Hostname, ControlURL: config.ControlURL, AuthKey: config.AuthKey,
		// Authentication URLs are carried by the IPN protocol, never parsed from logs.
		UserLogf: func(string, ...any) {},
	}
	var online atomic.Bool
	var privateURL atomic.Pointer[string]
	privateDial := func(ctx context.Context, network, address string) (net.Conn, error) {
		if !online.Load() {
			return nil, errors.New("private network is not connected")
		}
		return node.Dial(ctx, network, address)
	}
	proxy, err := newOutboundProxy(config.Routes, privateDial)
	if err != nil {
		return err
	}
	local, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return errors.New("local proxy could not listen")
	}
	defer local.Close()
	outbound := &http.Server{Handler: proxy, ReadHeaderTimeout: 15 * time.Second}
	defer outbound.Close()
	go func() { _ = outbound.Serve(local) }()
	notices.send(event{State: "proxy-ready", ProxyURL: "http://" + local.Addr().String()})
	var target atomic.Pointer[url.URL]
	go func() {
		defer cancel()
		for lines.Scan() {
			var request command
			if json.Unmarshal(lines.Bytes(), &request) != nil {
				return
			}
			if request.Target == "" {
				target.Store(nil)
				notices.send(event{State: "published", Revision: request.Revision})
				continue
			}
			parsed, err := loopbackTarget(request.Target)
			if err != nil {
				return
			}
			target.Store(parsed)
			notices.send(event{State: "published", Revision: request.Revision})
		}
	}()
	if err := node.Start(); err != nil {
		return errors.New("tailscale start failed")
	}
	defer node.Close()
	client, err := node.LocalClient()
	if err != nil {
		return errors.New("tailscale local API unavailable")
	}
	watch, err := client.WatchIPNBus(ctx, ipn.NotifyInitialState)
	if err != nil {
		return errors.New("tailscale state unavailable")
	}
	defer watch.Close()
	initial, err := client.Status(ctx)
	if err == nil && initial.AuthURL != "" {
		notices.send(event{State: "needs-login", LoginURL: initial.AuthURL})
	}
	go func() {
		for {
			change, err := watch.Next()
			if err != nil {
				return
			}
			if change.BrowseToURL != nil {
				notices.send(event{State: "needs-login", LoginURL: *change.BrowseToURL})
			}
			if change.State != nil {
				online.Store(*change.State == ipn.Running)
				switch *change.State {
				case ipn.Running:
					if address := privateURL.Load(); address != nil {
						notices.send(event{State: "online", URL: *address})
					}
				case ipn.NeedsMachineAuth:
					notices.send(event{State: "needs-approval"})
				case ipn.NeedsLogin:
					status, err := client.Status(ctx)
					if err == nil && status.AuthURL != "" {
						notices.send(event{State: "needs-login", LoginURL: status.AuthURL})
					}
					if err != nil || status.AuthURL == "" {
						notices.send(event{State: "connecting"})
					}
				default:
					notices.send(event{State: "connecting"})
				}
			}
		}
	}()
	status, err := node.Up(ctx)
	if err != nil {
		if ctx.Err() != nil {
			return nil
		}
		return errors.New("tailscale connection failed")
	}
	if status.Self == nil || len(status.TailscaleIPs) == 0 {
		return errors.New("tailscale address unavailable")
	}
	addresses := []string{strings.TrimSuffix(status.Self.DNSName, ".")}
	for _, address := range status.TailscaleIPs {
		addresses = append(addresses, address.String())
	}
	if addresses[0] == "" {
		addresses[0] = status.TailscaleIPs[0].String()
	}
	listener, err := node.Listen("tcp", ":80")
	if err != nil {
		return errors.New("private listener unavailable")
	}
	defer listener.Close()
	inbound := &http.Server{Handler: newInboundProxy(&target, addresses), ReadHeaderTimeout: 15 * time.Second}
	defer inbound.Close()
	go func() {
		if err := inbound.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			cancel()
		}
	}()
	online.Store(true)
	address := (&url.URL{Scheme: "http", Host: net.JoinHostPort(addresses[0], "80")}).String()
	privateURL.Store(&address)
	notices.send(event{State: "online", URL: address})
	<-ctx.Done()
	return nil
}

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--version" {
		fmt.Printf("dsh-tsnet protocol=%d tailscale=%s\n", protocolVersion, tailscaleVersion)
		return
	}
	if err := run(os.Stdin, os.Stdout); err != nil {
		(&events{writer: os.Stdout}).send(event{State: "error", Code: err.Error()})
		os.Exit(1)
	}
}
