package main

import (
	"fmt"
	"net/http"
	"time"

	"github.com/spf13/cobra"
)

// healthcheck is the image's HEALTHCHECK (the image has no shell or wget): it asks the
// running server for GET /api/health and exits 0 when the server answers 200. It opens
// no data and starts nothing, so it runs next to the server as often as needed.
func healthcheck() *cobra.Command {
	address := "http://127.0.0.1:8090/api/health"
	cmd := &cobra.Command{
		Use:          "healthcheck",
		Short:        "Exits 0 when the running server answers its health check",
		Args:         cobra.NoArgs,
		SilenceUsage: true,
		RunE: func(*cobra.Command, []string) error {
			return checkHealth(address)
		},
	}
	cmd.Flags().StringVar(&address, "url", address, "the server's health check address")
	return cmd
}

func checkHealth(address string) error {
	// Straight to the server: no proxy from the environment.
	client := http.Client{Timeout: 4 * time.Second, Transport: &http.Transport{}}
	res, err := client.Get(address)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("%s answered %s", address, res.Status)
	}
	return nil
}
