#!/bin/bash
set -e

ENVIRONMENT=${1:-dev}

echo "Building Lambda function for environment: $ENVIRONMENT"
echo "==========================================="

# Build using SAM
sam build --use-container

echo ""
echo "Build complete!"
echo "To test locally, run: ./scripts/test-local.sh"
echo "To deploy, run: ./scripts/deploy-lambda.sh $ENVIRONMENT"
