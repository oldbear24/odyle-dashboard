#!/usr/bin/env bash
# Image smoke test (#53): the image about to be published starts on a data volume the previous
# release made, owned by user 10001 as on servers, migrates it and answers its healthcheck; then
# it starts once more on the migrated volume. An upgrade that cannot migrate, start or write its
# data fails here, before the image is pushed. The candidate also answers 404 to the routes of the
# test build (/__test__/...), which sign anybody in as a superuser: the release image must not hold it.
#   scripts/image-smoke.sh <candidate image> [<previous image>]
# Without a previous image (or when it cannot be pulled) the candidate starts on a new volume.
set -euo pipefail
candidate="$1"
previous="${2:-}"
data="$(mktemp -d)"
sudo chown 10001:10001 "$data"

# The healthcheck the image's HEALTHCHECK runs, asked every two seconds for up to two minutes.
healthy() {
  for _ in $(seq 60); do
    if docker exec "$1" /pb/odyle healthcheck >/dev/null 2>&1; then
      return 0
    fi
    if [ "$(docker inspect -f '{{.State.Running}}' "$1")" != true ]; then
      break
    fi
    sleep 2
  done
  echo "::error::$1 did not answer its healthcheck"
  docker logs "$1" 2>&1 | tail -60
  return 1
}

# The test build's routes are not in this image: 404 for each, asked from the runner through the
# port the container publishes on loopback.
no_test_routes() {
  local address route code
  address="$(docker port "$1" 8090/tcp | head -n 1)"
  [ -n "$address" ] || { echo "::error::$1 publishes no port"; return 1; }
  for route in superuser account settle; do
    code="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "http://$address/__test__/$route")"
    if [ "$code" != 404 ]; then
      echo "::error::$1 answered $code to POST /__test__/$route; the release image must not hold the test build"
      return 1
    fi
  done
}

# start <name> <image> [check]: the container starts on the data volume and answers its healthcheck;
# with a third argument it also answers 404 for the test build's routes.
start() {
  docker run -d --name "$1" -p 127.0.0.1::8090 -v "$data:/pb/pb_data" "$2" >/dev/null
  healthy "$1"
  if [ -n "${3:-}" ]; then no_test_routes "$1"; fi
  docker stop -t 20 "$1" >/dev/null
  docker rm "$1" >/dev/null
  echo "$1 ($2) started and answered its healthcheck."
}

if [ -z "$previous" ]; then
  echo "No previous image to upgrade from; the candidate starts on a new volume."
elif docker pull -q "$previous" >/dev/null 2>&1; then
  start odyle-previous "$previous"
else
  echo "::warning::$previous could not be pulled; the candidate starts on a new volume instead."
fi
start odyle-candidate "$candidate" check
start odyle-restart "$candidate" check
