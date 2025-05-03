import * as cdk from "aws-cdk-lib";
import {
  aws_lambda,
  aws_rds,
  aws_ec2,
  aws_secretsmanager,
  aws_kms,
  aws_cloudfront,
  aws_cloudfront_origins,
  CfnOutput,
  aws_dynamodb,
  aws_apigateway,
  aws_certificatemanager,
  aws_route53,
  aws_route53_targets,
  aws_iam,
  aws_s3,
  aws_logs,
  aws_ecr,
  aws_ecs,
  aws_elasticloadbalancingv2,
  aws_s3_deployment,
  aws_lambda_event_sources,
} from "aws-cdk-lib";
import { Construct } from "constructs";

export interface AutomallStackProps extends cdk.StackProps {
  databaseUrl?: string;
  apiKey?: string;
  region?: string;
  stage?: string;
}

export class AutomallStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: AutomallStackProps) {
    super(scope, id, props);

    // Retrieve the environment context
    const environment = this.node.tryGetContext("environment") || "dev"; // default to "dev" if not provided
    const prefix = `automall-${environment}`; // Prefix for resource names

    // Environment variables are available via process.env
    const {
      RL_API_KEY,
      RL_USERNAME,
      RL_BASE_API_URL,
      POSTGRES_DB,
      GOOGLE_MAPS_API_KEY,
      OPENAI_API_KEY,
      ECR_REPO,
      SESSION_SECRET,
    } = process.env;

    // Validate required environment variables
    if (!RL_API_KEY) throw new Error('RL_API_KEY is required');
    if (!RL_USERNAME) throw new Error('RL_USERNAME is required');
    if (!RL_BASE_API_URL) throw new Error('RL_BASE_API_URL is required');
    if (!POSTGRES_DB) throw new Error('POSTGRES_DB is required');
    if (!GOOGLE_MAPS_API_KEY) throw new Error('GOOGLE_MAPS_API_KEY is required');
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');
    if (!SESSION_SECRET) throw new Error('SESSION_SECRET is required');

    // Get account ID for ECR repository
    const accountId = cdk.Stack.of(this).account;
    const region = cdk.Stack.of(this).region;
    const defaultEcrRepo = `${accountId}.dkr.ecr.${region}.amazonaws.com/automall-web`;
    
    // Use provided ECR_REPO or construct default one
    const ecrRepo = ECR_REPO || defaultEcrRepo;

    const vpc = new aws_ec2.Vpc(this, `${prefix}-vpc`, {
      maxAzs: 2,
      natGateways: 1,
    });

    // Create a security group for the ECS service
    const ecsSecurityGroup = new aws_ec2.SecurityGroup(
      this,
      `${prefix}-ecs-sg`,
      {
        vpc,
        allowAllOutbound: true,
        description: "Security group for ECS Fargate service",
      },
    );

    // Allow inbound traffic on port 80 for the ECS service
    ecsSecurityGroup.addIngressRule(
      aws_ec2.Peer.anyIpv4(),
      aws_ec2.Port.tcp(80),
      "Allow inbound HTTP traffic",
    );

    // Allow inbound traffic on port 443 for the ECS service
    ecsSecurityGroup.addIngressRule(
      aws_ec2.Peer.anyIpv4(),
      aws_ec2.Port.tcp(443),
      "Allow inbound HTTPS traffic",
    );

    // Create a security group for RDS
    const dbSecurityGroup = new aws_ec2.SecurityGroup(
      this,
      `${prefix}-db-sg`,
      {
        vpc,
        allowAllOutbound: true,
        description: "Security group for RDS instance",
      },
    );

    // Allow inbound access from ECS security group to RDS
    dbSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      aws_ec2.Port.tcp(5432),
      "Allow PostgreSQL access from ECS",
    );

    // Allow inbound access from your IP address
    dbSecurityGroup.addIngressRule(
      aws_ec2.Peer.ipv4('98.114.199.66/32'),  
      aws_ec2.Port.tcp(5432),
      "Allow PostgreSQL access from development machine",
    );

    // Step 4: Create a Secrets Manager Secret for DB credentials
    const dbCredentialsSecret = new aws_secretsmanager.Secret(
      this,
      `${prefix}-DbCredentialsSecret`,
      {
        secretName: `${prefix}-RdsDbCredentials`,
        generateSecretString: {
          secretStringTemplate: JSON.stringify({ username: "automall" }),
          generateStringKey: "password",
          excludeCharacters: "\"@/\\ '",
        },
      },
    );


    const DB_NAME = "automall";

    // Step 7: Create a RDS PostgreSQL instance
    const dbInstance = new aws_rds.DatabaseInstance(
      this,
      `${prefix}-RdsInstance`,
      {
        engine: aws_rds.DatabaseInstanceEngine.postgres({
          version: aws_rds.PostgresEngineVersion.VER_16,
        }),
        instanceType: aws_ec2.InstanceType.of(
          aws_ec2.InstanceClass.T3,
          aws_ec2.InstanceSize.MEDIUM,
        ),
        vpc,
        vpcSubnets: { subnetType: aws_ec2.SubnetType.PUBLIC },
        securityGroups: [dbSecurityGroup],
        credentials: aws_rds.Credentials.fromSecret(dbCredentialsSecret),
        databaseName: DB_NAME,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        deletionProtection: false,
        multiAz: false,
        allocatedStorage: 20,
        storageType: aws_rds.StorageType.GP2,
        publiclyAccessible: true
      },
    );
    // Retrieve the secret value for the password
    const dbPassword = dbCredentialsSecret
      .secretValueFromJson("password")
      .unsafeUnwrap(); // For demonstration; in practice, handle secrets securely

    // Retrieve the secret value for the username
    const dbUsername = dbCredentialsSecret
      .secretValueFromJson("username")
      .unsafeUnwrap(); // For demonstration; in practice, handle secrets securely

    // Create an ECS cluster
    const cluster = new aws_ecs.Cluster(this, `${prefix}-cluster`, {
      vpc: vpc,
    });

    const logName = `${prefix}-logs`;

    // Create an IAM Role for Fargate Task
    const fargateTaskRole = new aws_iam.Role(this, `${prefix}-iam-role`, {
      assumedBy: new aws_iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    const logGroup = new aws_logs.LogGroup(this, logName, {
      logGroupName: logName,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Adjust the removal policy as needed
    });

    // Define the ECS Task Definition
    const taskDefinition = new aws_ecs.FargateTaskDefinition(
      this,
      `${prefix}-ecs-fargate-definition`,
      {
        memoryLimitMiB: 8192, // Increased from 4096 to 8192 (8GB)
        cpu: 2048,           // Increased from 1024 to 2048 (2 vCPU)
        taskRole: fargateTaskRole,
        executionRole: fargateTaskRole,
        runtimePlatform: {
          operatingSystemFamily: aws_ecs.OperatingSystemFamily.LINUX,
          cpuArchitecture: aws_ecs.CpuArchitecture.ARM64,
        },
      },
    );

    // Function to parse the image URI
    function getRepositoryArn(imageUri: string): string {
      const [registryPart, repoWithTag] = imageUri.split(".amazonaws.com/");
      const [accountId, , , region] = registryPart.split(".");
      const [repositoryName] = repoWithTag.split(":");

      return `arn:aws:ecr:${region}:${accountId}:repository/${repositoryName}`;
    }

    const repository = aws_ecr.Repository.fromRepositoryArn(
      this,
      `${prefix}-container-repo`,
      getRepositoryArn(ecrRepo),
    );

    // Add container to the task definition
    const version = require("fs")
      .readFileSync("version.txt", "utf8")
      .trim();
    const container = taskDefinition.addContainer(`${prefix}-container`, {
      image: aws_ecs.ContainerImage.fromEcrRepository(repository, version),
      logging: aws_ecs.LogDrivers.awsLogs({
        streamPrefix: `${prefix}-logs`,
        logGroup: logGroup,
      }),
      environment: {
        ENVIRONMENT: environment,
        RL_API_KEY: RL_API_KEY,
        RL_USERNAME: RL_USERNAME,
        RL_BASE_API_URL: RL_BASE_API_URL,
        POSTGRES_DB: POSTGRES_DB,
        POSTGRES_USER: dbUsername,
        POSTGRES_PASSWORD: dbPassword,
        POSTGRES_HOST: dbInstance.dbInstanceEndpointAddress,
        POSTGRES_PORT: "5432",
        GOOGLE_MAPS_API_KEY: GOOGLE_MAPS_API_KEY,
        OPENAI_API_KEY: OPENAI_API_KEY,
        ECR_REPO: ecrRepo,
        SESSION_SECRET: SESSION_SECRET,
      },
      command: [
        "deno",
        "run",
        "--allow-net",
        "--allow-env",
        "--allow-read",
        "main.js"
      ],
    });

    container.addPortMappings({
      containerPort: 8000,
      hostPort: 8000,
      protocol: aws_ecs.Protocol.TCP,
    });

    // Create the ECS Fargate service
    const ecsService = new aws_ecs.FargateService(
      this,
      `${prefix}-ecs-service`,
      {
        cluster,
        taskDefinition,
        desiredCount: 3,  // Increased from 2 to 3 initial tasks
        securityGroups: [ecsSecurityGroup],
        assignPublicIp: true,
        platformVersion: aws_ecs.FargatePlatformVersion.VERSION1_4,
      },
    );

    // Auto Scaling Configuration
    const scaling = ecsService.autoScaleTaskCount({ 
      maxCapacity: 12,     // Increased from 10 to 12 max tasks
      minCapacity: 2       // Added minimum capacity
    });
    
    // CPU-based scaling
    scaling.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent: 60,  // Lowered from 70% to 60% to scale earlier
      scaleInCooldown: cdk.Duration.minutes(5),
      scaleOutCooldown: cdk.Duration.minutes(3),  // Reduced scale out cooldown for faster response
    });

    // Memory-based scaling
    scaling.scaleOnMemoryUtilization("MemoryScaling", {
      targetUtilizationPercent: 65,  // Scale when memory usage hits 65%
      scaleInCooldown: cdk.Duration.minutes(5),
      scaleOutCooldown: cdk.Duration.minutes(3),
    });

    const lb = new aws_elasticloadbalancingv2.ApplicationLoadBalancer(
      this,
      `${prefix}-lb`,
      {
        vpc,
        internetFacing: true,
        vpcSubnets: {
          subnetType: aws_ec2.SubnetType.PUBLIC,
          onePerAz: true,
        },
      },
    );

    // Import existing hosted zone
    const hostedZone = aws_route53.HostedZone.fromHostedZoneAttributes(this, `${prefix}-hosted-zone`, {
      hostedZoneId: 'Z04523141G4XZ54J2XRWO',
      zoneName: 'everysinglecar.com'
    });

    // Import existing certificate
    const certificate = aws_certificatemanager.Certificate.fromCertificateArn(
      this,
      `${prefix}-certificate`,
      'arn:aws:acm:us-east-1:626635413051:certificate/087b858f-c10a-4cdc-85a1-4fc2cdf8b4bb'
    );

    // HTTP Listener (redirects to HTTPS)
    const httpListener = lb.addListener(`${prefix}-http-listener`, {
      port: 80,
      protocol: aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
      defaultAction: aws_elasticloadbalancingv2.ListenerAction.redirect({
        port: "443",
        protocol: aws_elasticloadbalancingv2.ApplicationProtocol.HTTPS,
        permanent: true,
      }),
    });

    // HTTPS Listener
    const targetGroup = new aws_elasticloadbalancingv2.ApplicationTargetGroup(this, `${prefix}-target-group`, {
      vpc,
      port: 8000,
      protocol: aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
      targets: [ecsService],
      healthCheck: {
        path: "/health",
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        healthyHttpCodes: "200",
        port: "8000"
      },
    });

    const httpsListener = lb.addListener(`${prefix}-https-listener`, {
      port: 443,
      protocol: aws_elasticloadbalancingv2.ApplicationProtocol.HTTPS,
      certificates: [certificate],
      defaultAction: aws_elasticloadbalancingv2.ListenerAction.forward([targetGroup])
    });

    // Create A record in Route53
    new aws_route53.ARecord(this, `${prefix}-alias-record`, {
      zone: hostedZone,
      target: aws_route53.RecordTarget.fromAlias(
        new aws_route53_targets.LoadBalancerTarget(lb)
      ),
      recordName: 'everysinglecar.com'
    });

    // Create www subdomain
    new aws_route53.CnameRecord(this, `${prefix}-www-record`, {
      zone: hostedZone,
      recordName: 'www.everysinglecar.com',
      domainName: 'everysinglecar.com',
    });

    // Grant permissions to the task role
    logGroup.grantWrite(taskDefinition.taskRole);

    // Output the domain name
    new CfnOutput(this, "DomainName", {
      value: 'https://everysinglecar.com',
      description: "The domain name of the application",
    });

    // Output the load balancer DNS name
    new CfnOutput(this, "LoadBalancerDNS", {
      value: lb.loadBalancerDnsName,
      description: "The DNS name of the load balancer",
    });
  }
}