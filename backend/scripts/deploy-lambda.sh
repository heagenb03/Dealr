#!/bin/bash
set -e

ENVIRONMENT=${1:-dev}

echo "Deploying to environment: $ENVIRONMENT"
echo "======================================"

# Change to backend directory if not already there
cd "$(dirname "$0")/.."

# Build
echo "Building..."
sam build --use-container

# Deploy
echo ""
echo "Deploying to AWS..."
sam deploy \
  --config-env $ENVIRONMENT \
  --resolve-s3 \
  --resolve-image-repos \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset

# Get Function URL
echo ""
echo "Retrieving Function URL..."
FUNCTION_URL=$(aws cloudformation describe-stacks \
  --stack-name dealr-backend-$ENVIRONMENT \
  --query 'Stacks[0].Outputs[?OutputKey==`SettlementFunctionUrl`].OutputValue' \
  --output text 2>/dev/null || echo "")

if [ -n "$FUNCTION_URL" ]; then
    echo ""
    echo "==========================================="
    echo "Deployment complete!"
    echo "==========================================="
    echo ""
    echo "Function URL: $FUNCTION_URL"
    echo ""
    echo "Test the deployment:"
    echo "  curl $FUNCTION_URL/health"
    echo ""
    echo "Update frontend/.env.$ENVIRONMENT with:"
    echo "  EXPO_PUBLIC_API_BASE_URL=$FUNCTION_URL"
    echo ""
else
    echo ""
    echo "Deployment complete!"
    echo "Note: Could not retrieve Function URL automatically."
    echo "Check AWS Console or run: aws cloudformation describe-stacks --stack-name dealr-backend-$ENVIRONMENT"
fi
