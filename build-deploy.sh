#!/bin/bash

# Parse command line arguments
PROFILE="redline"  # Default profile
ENVIRONMENT=${ENVIRONMENT:-"dev"}  # Default to dev if not set

# Process command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --profile=*)
      PROFILE="${1#*=}"
      shift
      ;;
    --profile)
      PROFILE="$2"
      shift 2
      ;;
    --environment=*|--env=*)
      ENVIRONMENT="${1#*=}"
      shift
      ;;
    --environment|--env)
      ENVIRONMENT="$2"
      shift 2
      ;;
    *)
      # Save other arguments for passing to CDK later
      ARGS+=($1)
      shift
      ;;
  esac
done

echo "Using AWS profile: $PROFILE"
echo "Using environment: $ENVIRONMENT"

# Check if .env file exists
if [ -f ../.env ]; then
    # Load environment variables from .env file
    export $(cat ../.env | grep -v '^#' | xargs)
else
    echo "No .env file found"
    exit 1
fi

# Define variables
REGION="us-east-1"  # Hardcode the region
export AWS_DEFAULT_REGION=$REGION  # Set default region for AWS CLI
VERSION=${VERSION:-""}

# Get or create ECR repository with environment
REPO_NAME="automall-web-${ENVIRONMENT}"
echo "Checking ECR repository for environment: ${ENVIRONMENT}..."
ECR_REPO=$(aws ecr describe-repositories --profile $PROFILE --region $REGION --repository-names $REPO_NAME --query 'repositories[0].repositoryUri' --output text 2>/dev/null || \
    aws ecr create-repository --profile $PROFILE --region $REGION \
        --repository-name $REPO_NAME \
        --query 'repository.repositoryUri' \
        --output text)

if [ -z "$ECR_REPO" ]; then
    echo "Failed to create or find ECR repository"
    exit 1
fi

# Export ECR_REPO for CDK
export ECR_REPO

echo "Using ECR repository: $ECR_REPO"

# Read or initialize version
if [ ! -f version.txt ]; then
    echo "1.0.0" > version.txt
fi

CURRENT_VERSION=$(cat version.txt)
if [ -z "$VERSION" ]; then
    # Split version into parts
    IFS='.' read -r -a VERSION_PARTS <<< "$CURRENT_VERSION"
    
    # Increment patch version
    VERSION_PARTS[2]=$((VERSION_PARTS[2] + 1))
    
    # Reassemble version string
    VERSION="${VERSION_PARTS[0]}.${VERSION_PARTS[1]}.${VERSION_PARTS[2]}"
    # Write new version back to file
    echo "$VERSION" > version.txt
fi

# Create a new builder instance
docker buildx create --use
docker buildx inspect --bootstrap

# Login to ECR
aws ecr get-login-password --profile $PROFILE --region $REGION | docker login --username AWS --password-stdin $ECR_REPO

# Build and push the web app Docker image
echo "Building and pushing to ECR: $ECR_REPO:$VERSION (environment: $ENVIRONMENT)"
cd ../web_app
docker buildx build --platform linux/arm64 \
    -t $ECR_REPO:$VERSION \
    -t $ECR_REPO:$ENVIRONMENT \
    -t $ECR_REPO:latest \
    . --push
cd ../automall

echo "Build and push to ECR complete. Image: $ECR_REPO:$VERSION"

# Deploy the stack with environment context and specified profile
npx cdk deploy --profile $PROFILE --region $REGION --context environment=$ENVIRONMENT ${ARGS[@]:-}

# Clean up Docker buildx builders
echo "Cleaning up Docker buildx builders..."
docker buildx prune -f