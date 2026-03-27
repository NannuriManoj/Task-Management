#!/bin/sh

HOST="${POSTGRES_HOST:-postgres}"
USER="${POSTGRES_USER:-postgres}"

MAX_TRIES=30
WAIT_SECONDS=2

echo "Waiting for postgresql at $HOST..."

i=0
until pg_isready -h "$HOST" -U "$USER" -q; do
    i=$((i+1))
    if["$i" -ge "$MAX_TRIES"]; then
        echo "Postgresql not ready after $((MAX_TRIES * WAIT_SECONDS))s. EXITING"
        exit 1
    fi
    echo "attempt $i/$MAX_TRIES - retrying in ${WAIT_SECONDS}s"
    sleep "$WAIT_SECONDS"
done

echo "PostgreSQL is ready"
