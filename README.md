# AWS CDK Infrastructure Boilerplate

This repository contains a boilerplate AWS CDK (Cloud Development Kit) project that can be used as a template for creating infrastructure as code. It is designed to be easily understood and extended by AI assistants when creating new infrastructure projects.

## Project Structure

The project follows the standard CDK project structure:

```
/
├── bin/                  # Entry point for the CDK app
│   └── app.ts           # Main CDK application definition
├── lib/                  # Stack definitions and constructs
│   └── app-stack.ts     # Main stack definition
├── build-deploy.sh      # Deployment script for building and deploying
└── version.txt          # Tracks the current version of the infrastructure
```

## Key Components

### 1. CDK Application (`bin/app.ts`)

This is the entry point for the CDK application. It instantiates the stack(s) defined in the `lib` directory. When implementing a new project based on this template, this file should be updated to include the specific stack configurations needed.

### 2. Stack Definition (`lib/app-stack.ts`)

This file contains the main stack definition where AWS resources are defined. When implementing a new project, this is where most of the infrastructure code will be added. Common patterns include:

- VPC and networking resources
- Container services (ECS/EKS)
- Serverless resources (Lambda, API Gateway)
- Database resources (RDS, DynamoDB)
- Storage resources (S3)

### 3. Deployment Script (`build-deploy.sh`)

This script handles the build and deployment process with the following features:

- Supports different environments (dev, staging, prod) via the `--environment` flag
- Manages AWS profile selection via the `--profile` flag
- Handles Docker image building and pushing to ECR
- Automatic versioning using `version.txt`
- Deploys the CDK stack with the appropriate context

## How to Use This Template

When using this boilerplate as a template for a new infrastructure project:

1. **Understand the existing structure** - Review the files and understand their purpose
2. **Modify the stack definition** - Update `lib/app-stack.ts` to include the specific AWS resources needed
3. **Update the CDK app** - Modify `bin/app.ts` to configure the stack(s) as needed
4. **Customize the deployment script** - Adjust `build-deploy.sh` for project-specific requirements

## Deployment Process

The deployment process follows these steps:

1. Checks for environment variables in a `.env` file
2. Creates or uses an existing ECR repository based on the environment
3. Builds and tags a Docker image for the application
4. Pushes the image to ECR
5. Deploys the CDK stack with the appropriate context

## Example Usage

```bash
# Deploy to development environment with a specific AWS profile
./build-deploy.sh --profile=myprofile --environment=dev

# Deploy to production
./build-deploy.sh --profile=myprofile --environment=prod
```

## Extending the Template

When extending this template, consider:

1. Adding specific AWS resource patterns you commonly use
2. Implementing cross-stack references if using multiple stacks
3. Adding environment-specific configurations
4. Implementing CI/CD pipeline definitions
5. Adding custom constructs for reusable infrastructure components

## Best Practices

- Keep infrastructure code modular and reusable
- Use environment variables for sensitive information
- Leverage CDK constructs for higher-level abstractions
- Follow the principle of least privilege for IAM roles
- Use context variables for environment-specific settings

This boilerplate provides a foundation for creating well-structured, maintainable infrastructure as code using AWS CDK.# cdk-boilerplate
