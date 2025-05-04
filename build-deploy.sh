#!/bin/bash
#!/bin/bash
# Example usage:
#   ./build-deploy.sh --profile=myprofile --environment=prod  # Deploy to production
#   ./build-deploy.sh --profile=myprofile --env=dev           # Deploy to development
#   ./build-deploy.sh --skip-build --profile=myprofile        # Skip Docker build
#   ./build-deploy.sh --profile myprofile --env staging       # Alternative syntax

# Parse command line arguments
# UPDATE: Change the default profile to your AWS profile name
PROFILE="yourprofile"  # Default profile
ENVIRONMENT=${ENVIRONMENT:-"dev"}  # Default to dev if not set
SKIP_BUILD=false  # Default to building images

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
    --skip-build)
      SKIP_BUILD=true
      shift
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
if [ "$SKIP_BUILD" = true ]; then
  echo "Skipping build process, using last available images"
fi

# Check if .env file exists
# UPDATE: Adjust the path to your .env file based on your project structure
if [ -f ../.env ]; then
    # Load environment variables from .env file
    export $(cat ../.env | grep -v '^#' | xargs)
else
    echo "No .env file found"
    exit 1
fi

# Define variables
# UPDATE: Change the region to match your deployment region
REGION="us-east-1"  # Hardcode the region
export AWS_DEFAULT_REGION=$REGION  # Set default region for AWS CLI
VERSION=${VERSION:-""}

# Get or create ECR repository with environment
# UPDATE: Change the repository name prefix to match your project name
REPO_NAME="silodown-web-${ENVIRONMENT}"
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

# Only increment version if we're building (not skipping build)
if [ -z "$VERSION" ]; then
    if [ "$SKIP_BUILD" = false ]; then
        # Split version into parts
        IFS='.' read -r -a VERSION_PARTS <<< "$CURRENT_VERSION"
        
        # Increment patch version
        VERSION_PARTS[2]=$((VERSION_PARTS[2] + 1))
        
        # Reassemble version string
        VERSION="${VERSION_PARTS[0]}.${VERSION_PARTS[1]}.${VERSION_PARTS[2]}"
        # Write new version back to file
        echo "$VERSION" > version.txt
        echo "Incrementing version to: $VERSION"
    else
        # Use current version without incrementing
        VERSION="$CURRENT_VERSION"
        echo "Using existing version: $VERSION (not incrementing because build is skipped)"
    fi
fi

# Only build and push images if not skipping build
if [ "$SKIP_BUILD" = false ]; then
  # Create a new builder instance
  docker buildx create --use
  docker buildx inspect --bootstrap
  
  # Login to ECR
  aws ecr get-login-password --profile $PROFILE --region $REGION | docker login --username AWS --password-stdin $ECR_REPO
  
  # Build and push the web app Docker image
  echo "Building and pushing to ECR: $ECR_REPO:$VERSION (environment: $ENVIRONMENT)"
  cd ..
  # UPDATE: Adjust the platform flag if you're not targeting ARM64 architecture
  # UPDATE: Change the Dockerfile name if your Dockerfile has a different name
  docker buildx build --platform linux/arm64 \
      -t $ECR_REPO:$VERSION \
      -t $ECR_REPO:$ENVIRONMENT \
      -t $ECR_REPO:latest \
      -f Dockerfile.web \
      . --push
  # UPDATE: Change this directory name to match your infrastructure directory name
  cd infra-silodown
  
  echo "Build and push to ECR complete. Image: $ECR_REPO:$VERSION"
else
  echo "Skipping build process, using existing image: $ECR_REPO:$VERSION"
  # Still need to change directory back to infrastructure directory if we're in the parent directory
  # UPDATE: Change 'infra-silodown' to match your infrastructure directory name
  if [ "$(basename "$(pwd)")" != "infra-silodown" ]; then
    cd infra-silodown
  fi
fi

# Deploy the stack with environment context and specified profile
# Deploy the stack with CDK
echo "Deploying CDK stack with environment: $ENVIRONMENT, ECR repo: $ECR_REPO"
# Get current public IP address
MY_IP=$(curl -s https://api.ipify.org)
echo "Using IP address for DB ingress: $MY_IP"

# UPDATE: Adjust the context parameters based on what your CDK stack expects
npx cdk deploy \
  --profile $PROFILE \
  --region $REGION \
  --context environment=$ENVIRONMENT \
  --context ecrRepo=$ECR_REPO \
  --context version=$VERSION \
  --context allowedIp=$MY_IP \
  ${ARGS[@]:-}

# Clean up Docker buildx builders only if we built images
if [ "$SKIP_BUILD" = false ]; then
  echo "Cleaning up Docker buildx builders..."
  docker buildx prune -f
fi