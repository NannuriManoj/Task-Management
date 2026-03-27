#!/bin/sh

set -e

wait-for-pg

echo "Running migrations..."

if[ "$NODE_ENV" = "production" ]; then
    node dist/db/migrate.js
else
    npx tsx src/db/migrate.ts
fi

echo "Migrations completed"

echo "Starting application..."
exec "$@"