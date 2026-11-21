// Forwards TCP connections from every container interface to a port on
// localhost. A dev server started with its defaults (Vite, Nuxt, Next) binds
// 127.0.0.1 only, which the preview proxy cannot reach from outside the
// container; this runs under supervisord next to the dev server
// (server/daemon/ddev.ts) and is what the proxy targets instead. A connection
// while the dev server is down is closed right away, so a health poll keeps
// polling.
package main

import (
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

// A plain server may wait for a header end that a TLS hello never sends.
const handshakeTimeout = time.Second

const (
	modeUnknown int32 = iota
	modeTLS
	modePlain
)

// A dev server started with https (mkcert, basic-ssl) only speaks TLS while
// Knecht speaks plain http, so the upstream side is wrapped when needed.
var mode atomic.Int32

func main() {
	listenPort, okListen := parsePort(os.Args, 1)
	targetPort, okTarget := parsePort(os.Args, 2)
	if !okListen || !okTarget {
		fmt.Fprintln(os.Stderr, "usage: knecht-forward <listen-port> <target-port>")
		os.Exit(2)
	}
	target := net.JoinHostPort("127.0.0.1", strconv.Itoa(targetPort))
	listener, err := net.Listen("tcp4", net.JoinHostPort("0.0.0.0", strconv.Itoa(listenPort)))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	for {
		client, err := listener.Accept()
		if err != nil {
			continue
		}
		go forward(client, target)
	}
}

func parsePort(args []string, i int) (int, bool) {
	if len(args) <= i {
		return 0, false
	}
	port, err := strconv.Atoi(args[i])
	return port, err == nil && port > 0 && port <= 65535
}

func dial(target string, secure bool) (net.Conn, error) {
	conn, err := net.DialTimeout("tcp", target, handshakeTimeout)
	if err != nil || !secure {
		return conn, err
	}
	tlsConn := tls.Client(conn, &tls.Config{InsecureSkipVerify: true})
	tlsConn.SetDeadline(time.Now().Add(handshakeTimeout))
	if err := tlsConn.Handshake(); err != nil {
		conn.Close()
		return nil, err
	}
	tlsConn.SetDeadline(time.Time{})
	return tlsConn, nil
}

func connectUpstream(target string) net.Conn {
	if mode.Load() != modePlain {
		conn, err := dial(target, true)
		if err == nil {
			mode.Store(modeTLS)
			return conn
		}
		if errors.Is(err, syscall.ECONNREFUSED) {
			return nil
		}
	}
	conn, err := dial(target, false)
	if err != nil {
		return nil
	}
	mode.Store(modePlain)
	return conn
}

type countingReader struct {
	r io.Reader
	n atomic.Int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n.Add(int64(n))
	return n, err
}

func forward(client net.Conn, target string) {
	upstream := connectUpstream(target)
	if upstream == nil {
		client.Close()
		return
	}
	fromClient := &countingReader{r: client}
	fromUpstream := &countingReader{r: upstream}
	var once sync.Once
	drop := func() {
		once.Do(func() {
			// A TLS-only server closes a plain request without a byte: detect again next time.
			if fromUpstream.n.Load() == 0 && fromClient.n.Load() > 0 {
				mode.CompareAndSwap(modePlain, modeUnknown)
			}
			client.Close()
			upstream.Close()
		})
	}
	go func() {
		io.Copy(upstream, fromClient)
		drop()
	}()
	io.Copy(client, fromUpstream)
	drop()
}
