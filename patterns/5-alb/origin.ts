import { aws_cloudfront as cloudfront, aws_cloudfront_origins as origins, aws_ec2 as ec2, aws_ecs as ecs, aws_ecs_patterns as ecsPatterns, aws_wafv2 as wafv2 } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { PATTERN_SCOPES } from '../../lib/auth';
import { CLOUDFRONT_ORIGIN_FACING } from '../../lib/vpc';
import { ORIGIN_VERIFY_HEADER, OriginProps } from '../../lib/waf';

// CloudFront VPC origin -> internal ALB -> one Fargate task, all in isolated subnets.
// The ALB has no public IP, so CloudFront is the only way in from the internet.
// The hello server checks each token itself: ALB JWT verification needs an HTTPS listener, so a certificate for your own
// domain (see the README). It fetches the signing keys through a cognito-idp VPC endpoint, as there is no NAT.
export function albOrigin(scope: Construct, { image, originSecret, originWafArn, vpc, auth }: OriginProps): cloudfront.IOrigin {
  vpc.addInterfaceEndpoint('EcrApi', { service: ec2.InterfaceVpcEndpointAwsService.ECR });
  vpc.addInterfaceEndpoint('EcrDocker', { service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER });
  vpc.addInterfaceEndpoint('Logs', { service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS });
  vpc.addInterfaceEndpoint('CognitoIdp', { service: ec2.InterfaceVpcEndpointAwsService.COGNITO_IDP }); // <issuer>/.well-known/jwks.json

  const service = new ecsPatterns.ApplicationLoadBalancedFargateService(scope, 'AlbFargate', { // an ALB cannot change VPC: rename it (and its VPC origin) when the VPC is replaced
    vpc,
    publicLoadBalancer: false,
    openListener: false,
    taskSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
    cpu: 256,
    memoryLimitMiB: 512,
    desiredCount: 1,
    minHealthyPercent: 100,
    circuitBreaker: { rollback: true },
    taskImageOptions: {
      image: ecs.ContainerImage.fromEcrRepository(image.repository, image.imageTag),
      containerPort: 8000,
      environment: { JWT_ISSUER: auth.issuer, JWT_SCOPE: PATTERN_SCOPES.alb, JWT_VERIFY: 'true' },
    },
  });
  service.loadBalancer.connections.allowFrom(CLOUDFRONT_ORIGIN_FACING, ec2.Port.tcp(80));

  // Second WAF layer: blocks anything inside the VPC that calls the ALB without CloudFront's secret header.
  new wafv2.CfnWebACLAssociation(scope, 'AlbWafAssociation', {
    resourceArn: service.loadBalancer.loadBalancerArn,
    webAclArn: originWafArn,
  });

  // A named VPC origin: CloudFront cannot update one in place while a distribution uses it, so changes replace it.
  const vpcOrigin = new cloudfront.VpcOrigin(scope, 'AlbFargateOrigin', {
    endpoint: cloudfront.VpcOriginEndpoint.applicationLoadBalancer(service.loadBalancer),
    httpPort: 80,
    protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
  });
  return origins.VpcOrigin.withVpcOrigin(vpcOrigin, {
    domainName: service.loadBalancer.loadBalancerDnsName,
    customHeaders: { [ORIGIN_VERIFY_HEADER]: originSecret },
  });
}
