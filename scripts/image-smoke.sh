#!/usr/bin/env bash
# Image smoke test (#53): the image about to be published starts on a data volume the previous
# release made, owned by user 10001 as on servers, migrates it and answers its healthcheck; then
# it starts once more on the migrated volume. An upgrade that cannot migrate, start or write its
# data fails here, before the image is pushed.
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

start() {
  docker run -d --name "$1" -v "$data:/pb/pb_data" "$2" >/dev/null
  healthy "$1"
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
start odyle-candidate "$candidate"
start odyle-restart "$candidate"
