#!/bin/bash
set -euo pipefail

# Base URL of the server under test. Override with e.g. BASE_URL=http://localhost:3001 ./runtest.sh
PORT="${PORT:-3000}"
BASE_URL="${BASE_URL:-http://localhost:$PORT}"

cleanup() {
  echo "Cleaning up..."
  podman stop dashboard-server >/dev/null 2>&1 || true
  podman rm dashboard-server >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Step 0: Quick check, run first so we fail fast before the slower build/
# podman/Playwright steps below.
echo "Checking run backend availability..."
node tests/run-backend-availability-test.js

# Step 1: Build your static site
echo "Building static site..."
npm run build

# Step 2: Serve the static site with nginx
echo "Starting nginx server..."
podman run -d \
  --name dashboard-server \
  -v ./dist:/usr/share/nginx/html:ro \
  -p "$PORT":80 \
  docker.io/nginx:alpine

# Wait for server to be ready
sleep 2
echo "Server running at $BASE_URL"

# Step 3: Run Playwright tests
# Note: This is a ~2GB download on first run
echo "Running tests..."
mkdir -p ./test-output
podman run --rm \
  --network host \
  -v ./tests:/tests:ro \
  -v ./test-output:/tests/test-output:rw \
  -v ./src/data:/tests/data:ro \
  mcr.microsoft.com/playwright:v1.63.0-jammy \
  sh -c "mkdir -p /work && cd /work && cp /tests/dashboard-test.js . && echo '{\"type\":\"module\"}' > package.json && npm install playwright d3-dsv && BASE_URL=$BASE_URL RUNS_CSV=/tests/data/runs.csv node dashboard-test.js"

echo "✓ All tests passed!"
