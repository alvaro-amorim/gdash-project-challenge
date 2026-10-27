package main

import (
	"bytes"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

const (
	QueueName   = "weather_data"
	ContentType = "application/json"
)

var httpClient = &http.Client{
	Timeout: 10 * time.Second,
	CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

func failOnError(err error, msg string) {
	if err != nil {
		log.Fatalf("%s: %s", msg, err)
	}
}

func dispatchPayload(client *http.Client, apiURL string, jsonBody []byte) error {
	req, err := http.NewRequest("POST", apiURL, bytes.NewBuffer(jsonBody))
	if err != nil {
		return fmt.Errorf("create API request: %w", err)
	}
	req.Header.Set("Content-Type", ContentType)
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("send API request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return fmt.Errorf("API rejected payload with status %d", resp.StatusCode)
	}
	return nil
}

func consumeMessages(ch *amqp.Channel, queue string) (<-chan amqp.Delivery, error) {
	if err := ch.Qos(1, 0, false); err != nil {
		return nil, fmt.Errorf("set consumer prefetch: %w", err)
	}
	return ch.Consume(queue, "", false, false, false, false, nil)
}

// Delivery is at least once: a successful POST can be repeated if its ACK is lost.
func handleDelivery(d amqp.Delivery, dispatch func([]byte) error, retryDelay time.Duration) error {
	if err := dispatch(d.Body); err != nil {
		log.Printf("[WARN] Delivery failed; retaining message for retry: %v", err)
		// Pause before requeueing to avoid a hot retry loop during an outage.
		time.Sleep(retryDelay)
		if err := d.Nack(false, true); err != nil {
			return fmt.Errorf("requeue delivery: %w", err)
		}
		return nil
	}
	if err := d.Ack(false); err != nil {
		return fmt.Errorf("acknowledge delivery: %w", err)
	}
	return nil
}

func main() {
	rabbitHost := os.Getenv("RABBIT_HOST")
	if rabbitHost == "" {
		rabbitHost = "localhost"
	}
	connString := fmt.Sprintf("amqp://admin:password123@%s:5672/", rabbitHost)
	log.Printf("[INIT] Connecting to RabbitMQ at %s...", rabbitHost)
	conn, err := amqp.Dial(connString)
	failOnError(err, "Failed to connect to RabbitMQ")
	defer conn.Close()
	ch, err := conn.Channel()
	failOnError(err, "Failed to open a channel")
	defer ch.Close()
	q, err := ch.QueueDeclare(QueueName, true, false, false, false, nil)
	failOnError(err, "Failed to declare a queue")
	msgs, err := consumeMessages(ch, q.Name)
	failOnError(err, "Failed to register a consumer")

	apiHost := os.Getenv("API_HOST")
	if apiHost == "" {
		apiHost = "localhost"
	}
	apiURL := fmt.Sprintf("http://%s:3000/weather", apiHost)
	log.Printf("[READY] Worker started. Waiting for messages in '%s'", QueueName)
	for d := range msgs {
		log.Printf("[RECEIVED] Processing message size: %d bytes", len(d.Body))
		err := handleDelivery(d, func(body []byte) error {
			return dispatchPayload(httpClient, apiURL, body)
		}, 5*time.Second)
		failOnError(err, "Failed to settle delivery")
	}
	// The container restart policy can recover a closed consumer channel.
	log.Fatal("Consumer channel closed; worker must reconnect")
}
