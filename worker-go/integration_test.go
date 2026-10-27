package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

func brokerForTest(t *testing.T) (*amqp.Connection, *amqp.Channel, string) {
	t.Helper()
	url := os.Getenv("GDASH_TEST_AMQP_URL")
	if url == "" {
		t.Skip("set GDASH_TEST_AMQP_URL to run real RabbitMQ integration tests")
	}
	conn, err := amqp.Dial(url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	ch, err := conn.Channel()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ch.Close() })
	q, err := ch.QueueDeclare(fmt.Sprintf("gdash-test-%d", time.Now().UnixNano()), false, false, false, false, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, err := conn.Channel()
		if err != nil {
			return
		}
		defer cleanup.Close()
		_, _ = cleanup.QueueDelete(q.Name, false, false, false)
	})
	return conn, ch, q.Name
}

func receiveDelivery(t *testing.T, deliveries <-chan amqp.Delivery) amqp.Delivery {
	t.Helper()
	select {
	case d, ok := <-deliveries:
		if !ok {
			t.Fatal("consumer channel closed")
		}
		return d
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for RabbitMQ delivery")
		return amqp.Delivery{}
	}
}

func publishForTest(t *testing.T, ch *amqp.Channel, queue string) {
	t.Helper()
	if err := ch.Publish("", queue, false, false, amqp.Publishing{
		ContentType: ContentType, Body: []byte(`{"temp":25,"collected_at":"2026-03-24T12:00:00"}`),
	}); err != nil {
		t.Fatal(err)
	}
}

func TestRabbitMQRedelivery(t *testing.T) {
	for _, scenario := range []string{"API failure", "disconnect after persistence before ACK"} {
		t.Run(scenario, func(t *testing.T) {
			conn, ch, queue := brokerForTest(t)
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if requests.Add(1) == 1 && scenario == "API failure" {
					w.WriteHeader(http.StatusServiceUnavailable)
					return
				}
				w.WriteHeader(http.StatusCreated)
			}))
			defer server.Close()
			dispatch := func(body []byte) error { return dispatchPayload(httpClient, server.URL, body) }
			messages, err := consumeMessages(ch, queue)
			if err != nil {
				t.Fatal(err)
			}
			publishForTest(t, ch, queue)
			first := receiveDelivery(t, messages)
			if scenario == "API failure" {
				if err := handleDelivery(first, dispatch, 0); err != nil {
					t.Fatal(err)
				}
			} else {
				// The API committed, but the worker disconnected without settling delivery.
				if err := dispatch(first.Body); err != nil {
					t.Fatal(err)
				}
				if err := ch.Close(); err != nil {
					t.Fatal(err)
				}
				ch, err = conn.Channel()
				if err != nil {
					t.Fatal(err)
				}
				messages, err = consumeMessages(ch, queue)
				if err != nil {
					t.Fatal(err)
				}
			}
			second := receiveDelivery(t, messages)
			if !second.Redelivered || string(second.Body) != string(first.Body) {
				t.Fatal("RabbitMQ did not retain the original payload for redelivery")
			}
			if err := handleDelivery(second, dispatch, 0); err != nil {
				t.Fatal(err)
			}
			if requests.Load() != 2 {
				t.Fatalf("expected two API attempts, got %d", requests.Load())
			}
			if err := ch.Close(); err != nil {
				t.Fatal(err)
			}
			inspection, err := conn.Channel()
			if err != nil {
				t.Fatal(err)
			}
			defer inspection.Close()
			state, err := inspection.QueueInspect(queue)
			if err != nil || state.Messages != 0 {
				t.Fatalf("successful message returned to queue: state=%+v err=%v", state, err)
			}
		})
	}
}

func TestRabbitMQPrefetch(t *testing.T) {
	_, ch, queue := brokerForTest(t)
	messages, err := consumeMessages(ch, queue)
	if err != nil {
		t.Fatal(err)
	}
	publishForTest(t, ch, queue)
	publishForTest(t, ch, queue)
	first := receiveDelivery(t, messages)
	select {
	case <-messages:
		t.Fatal("consumer received another message before settling the first")
	case <-time.After(150 * time.Millisecond):
	}
	if err := first.Ack(false); err != nil {
		t.Fatal(err)
	}
	second := receiveDelivery(t, messages)
	if err := second.Ack(false); err != nil {
		t.Fatal(err)
	}
}
