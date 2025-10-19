#!/bin/bash

# Step 1: Build your static site
echo "Building static site..."
npm run build

# Step 2: Serve the static site with nginx
echo "Starting nginx server..."
podman run -d \
  --name dashboard-server \
  -v ./dist:/usr/share/nginx/html:ro \
  -p 3000:80 \
  docker.io/nginx:alpine

# Wait for server to be ready
sleep 2
echo "Server running at http://localhost:3000"

# Step 3: Run Playwright tests
# Note: This is a ~2GB download on first run
echo "Running tests..."
mkdir -p ./test-output
podman run --rm \
  --network host \
  -v ./tests:/tests:ro \
  -v ./test-output:/tests/test-output:rw \
  mcr.microsoft.com/playwright:v1.56.1-jammy \
  sh -c "mkdir -p /work && cd /work && cp /tests/dashboard-test.js . && echo '{\"type\":\"module\"}' > package.json && npm install playwright && node dashboard-test.js"

# Capture exit code
TEST_EXIT=$?

# Step 4: Cleanup
echo "Cleaning up..."
podman stop dashboard-server
podman rm dashboard-server

if [ $TEST_EXIT -eq 0 ]; then
  echo "✓ All tests passed!"
else
  echo "✗ Tests failed with exit code $TEST_EXIT"
fi

exit $TEST_EXIT
