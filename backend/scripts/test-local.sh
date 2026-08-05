#!/bin/bash
set -e

echo "Starting local Lambda API..."
echo "============================"
echo ""

# Build first
echo "Building Lambda function..."
sam build --use-container

echo ""
echo "Starting SAM local API on port 8080..."
echo ""
echo "Test endpoints:"
echo "  Health check:"
echo "    curl http://localhost:8080/health"
echo ""
echo "  Settlement calculation:"
echo "    curl -X POST http://localhost:8080/settlements/optimal \\"
echo "      -H \"Content-Type: application/json\" \\"
echo "      -d @test-data/2-players.json"
echo ""
echo "Press Ctrl+C to stop the server"
echo "============================"
echo ""

# Start local API (simulates Function URL)
sam local start-api --port 8080
