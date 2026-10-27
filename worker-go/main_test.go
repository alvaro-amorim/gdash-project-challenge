package main

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

type acknowledgement struct {
	mu                sync.Mutex
	acks, nacks       int
	tag               uint64
	multiple, requeue bool
	err               error
}

func (a *acknowledgement) Ack(tag uint64, multiple bool) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.acks++
	a.tag, a.multiple = tag, multiple
	return a.err
}

func (a *acknowledgement) Nack(tag uint64, multiple, requeue bool) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.nacks++
	a.tag, a.multiple, a.requeue = tag, multiple, requeue
	return a.err
}

func (a *acknowledgement) Reject(_ uint64, _ bool) error {
	return errors.New("unexpected reject: message would be discarded")
}

func TestDeliveryHTTPOutcomes(t *testing.T) {
	for _, status := range []int{200, 201, 202, 302, 400, 401, 429, 500, 503} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			a := &acknowledgement{}
			body := []byte(`{"temp":25,"collected_at":"2026-03-24T12:00:00"}`)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				a.mu.Lock()
				if a.acks != 0 || a.nacks != 0 {
					t.Error("message settled before API response")
				}
				a.mu.Unlock()
				payload, _ := io.ReadAll(r.Body)
				if r.Method != "POST" || r.Header.Get("Content-Type") != ContentType || string(payload) != string(body) {
					t.Error("request contract was not preserved")
				}
				w.WriteHeader(status)
			}))
			defer server.Close()
			d := amqp.Delivery{Acknowledger: a, DeliveryTag: 42, Body: body}
			if err := handleDelivery(d, func(body []byte) error {
				return dispatchPayload(httpClient, server.URL, body)
			}, 0); err != nil {
				t.Fatal(err)
			}
			if status == 200 || status == 201 {
				if a.acks != 1 || a.nacks != 0 {
					t.Fatal("success was not acknowledged exactly once")
				}
			} else if a.acks != 0 || a.nacks != 1 || !a.requeue {
				t.Fatal("failure was not retained for retry")
			}
			if a.tag != 42 || a.multiple {
				t.Fatal("settled another delivery")
			}
		})
	}
}

func TestDeliveryTransportFailuresAreRequeued(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(60 * time.Millisecond)
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()
	closed := httptest.NewServer(http.NotFoundHandler())
	closed.Close()
	for _, apiURL := range []string{server.URL, closed.URL, "://invalid"} {
		a := &acknowledgement{}
		d := amqp.Delivery{Acknowledger: a, DeliveryTag: 1, Body: []byte(`{}`)}
		client := &http.Client{Timeout: 10 * time.Millisecond}
		if err := handleDelivery(d, func(body []byte) error {
			return dispatchPayload(client, apiURL, body)
		}, 0); err != nil {
			t.Fatal(err)
		}
		if a.acks != 0 || a.nacks != 1 || !a.requeue {
			t.Fatal("transport failure was not requeued")
		}
	}
}

func TestDeliverySettlementErrorsStopConsumer(t *testing.T) {
	settlementErr := errors.New("channel closed")
	for _, dispatchErr := range []error{nil, errors.New("API unavailable")} {
		a := &acknowledgement{err: settlementErr}
		d := amqp.Delivery{Acknowledger: a, DeliveryTag: 1}
		err := handleDelivery(d, func([]byte) error { return dispatchErr }, 0)
		if !errors.Is(err, settlementErr) {
			t.Fatalf("settlement error lost: %v", err)
		}
	}
}

func TestRedirectDoesNotAcknowledgeLoginPage(t *testing.T) {
	var followed atomic.Bool
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { followed.Store(true) }))
	defer target.Close()
	server := httptest.NewServer(http.RedirectHandler(target.URL, http.StatusFound))
	defer server.Close()
	if err := dispatchPayload(httpClient, server.URL, []byte(`{}`)); err == nil || followed.Load() {
		t.Fatalf("redirect accepted as persistence: err=%v followed=%v", err, followed.Load())
	}
}
