import { aws_apigateway as apigw, aws_cloudfront as cloudfront, aws_cloudfront_origins as origins, aws_ec2 as ec2, aws_elasticloadbalancingv2 as elbv2, aws_elasticloadbalancingv2_targets as targets, aws_iam as iam, aws_lambda as lambda, aws_wafv2 as wafv2, CustomResource, Duration, Stack } from 'aws-cdk-lib';
import { readFileSync } from 'fs';
import * as path from 'path';
import { Construct } from 'constructs';
import { McpAuth } from '../../lib/auth';
import { HelloImage } from '../../lib/edge';
import { CLOUDFRONT_ORIGIN_FACING } from '../../lib/vpc';
import { ORIGIN_VERIFY_HEADER } from '../../lib/waf';

export interface ApiGatewayOriginProps {
  image: HelloImage;
  originSecret: string;
  originWafArn: string;
  vpc: ec2.IVpc;
  auth: McpAuth;
}

// CloudFront VPC origin -> internal NLB (TCP passthrough) -> execute-api VPC endpoint -> private REST API -> Lambda (hello image + Lambda Web Adapter).
// The API has no public endpoint: its resource policy admits only the VPC endpoint.
// An Amazon Cognito authorizer on every method checks the token and its mcp/api-gateway scope before Lambda runs.
export function apiGatewayOrigin(scope: Construct, { image, originSecret, originWafArn, vpc, auth }: ApiGatewayOriginProps): cloudfront.IOrigin {
  const fn = new lambda.DockerImageFunction(scope, 'ApiGatewayHello', {
    code: lambda.DockerImageCode.fromEcr(image.repository, { tagOrDigest: image.imageTag }),
    architecture: lambda.Architecture.ARM_64,
    memorySize: 512,
    timeout: Duration.seconds(29),
    environment: { JWT_ISSUER: auth.issuer, JWT_SCOPE: auth.scope }, // serves /.well-known metadata; the authorizer checks tokens
  });

  // A load balancer cannot change VPC or type in place: rename it (and its VPC origin) when either changes.
  const nlb = new elbv2.NetworkLoadBalancer(scope, 'ApiGatewayNlb', {
    vpc,
    internetFacing: false,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    securityGroups: [new ec2.SecurityGroup(scope, 'ApiGatewayNlbSecurityGroup', { vpc, allowAllOutbound: false })], // a VPC origin needs one
  });
  nlb.connections.allowFrom(CLOUDFRONT_ORIGIN_FACING, ec2.Port.tcp(443));

  const endpoint = vpc.addInterfaceEndpoint('ExecuteApi', {
    service: ec2.InterfaceVpcEndpointAwsService.APIGATEWAY,
    privateDnsEnabled: false, // keep public execute-api DNS working for anything else in the VPC
    open: false,
  });
  endpoint.connections.allowFrom(nlb, ec2.Port.tcp(443));

  const api = new apigw.LambdaRestApi(scope, 'ApiGatewayApi', {
    handler: fn,
    proxy: false, // explicit methods below, so /.well-known can skip the authorizer
    endpointConfiguration: { types: [apigw.EndpointType.PRIVATE], vpcEndpoints: [endpoint] },
    policy: new iam.PolicyDocument({
      statements: [new iam.PolicyStatement({
        principals: [new iam.AnyPrincipal()],
        actions: ['execute-api:Invoke'],
        resources: ['execute-api:/*'],
        conditions: { StringEquals: { 'aws:SourceVpce': endpoint.vpcEndpointId } },
      })],
    }),
    defaultMethodOptions: {
      authorizer: new apigw.CognitoUserPoolsAuthorizer(scope, 'ApiGatewayAuthorizer', { cognitoUserPools: [auth.userPool] }),
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizationScopes: [auth.scope],
    },
  });
  api.root.addMethod('ANY');
  api.root.addProxy();
  // Discovery answers without a token.
  api.root.resourceForPath('/.well-known/oauth-protected-resource/mcp')
    .addMethod('GET', undefined, { authorizationType: apigw.AuthorizationType.NONE, authorizer: undefined });

  // The NLB targets the endpoint's ENI IPs; CloudFormation exposes only the ENI IDs, so look the IPs up once.
  const lookup = new lambda.Function(scope, 'ExecuteApiEndpointIpsFunction', {
    runtime: lambda.Runtime.NODEJS_24_X,
    handler: 'index.handler',
    code: lambda.Code.fromInline(readFileSync(path.join(__dirname, 'endpoint-ips.js'), 'utf8')),
    timeout: Duration.seconds(30),
  });
  lookup.addToRolePolicy(new iam.PolicyStatement({ actions: ['ec2:DescribeNetworkInterfaces'], resources: ['*'] })); // takes no resource ARN
  const eniIps = new CustomResource(scope, 'ExecuteApiEndpointAddresses', {
    serviceToken: lookup.functionArn,
    resourceType: 'Custom::ExecuteApiEndpointIps',
    properties: { NetworkInterfaceIds: endpoint.vpcEndpointNetworkInterfaceIds, EndpointId: endpoint.vpcEndpointId },
  });
  // TCP passthrough: TLS runs end to end between CloudFront and the endpoint, which presents the execute-api certificate.
  nlb.addListener('Tcp', { port: 443, protocol: elbv2.Protocol.TCP }).addTargets('ExecuteApi', {
    port: 443,
    protocol: elbv2.Protocol.TCP,
    targets: [0, 1].map((i) => new targets.IpTarget(eniIps.getAttString(`Ip${i}`))),
  });

  // Regional WAF on the API stage: it blocks requests without CloudFront's secret header. An NLB takes no web ACL.
  new wafv2.CfnWebACLAssociation(scope, 'ApiGatewayWafAssociation', { resourceArn: api.deploymentStage.stageArn, webAclArn: originWafArn });

  // A named VPC origin: CloudFront cannot update one in place while a distribution uses it, so changes replace it.
  const vpcOrigin = new cloudfront.VpcOrigin(scope, 'ApiGatewayNlbOrigin', {
    endpoint: cloudfront.VpcOriginEndpoint.networkLoadBalancer(nlb),
    httpsPort: 443,
    protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
  });
  return origins.VpcOrigin.withVpcOrigin(vpcOrigin, {
    // The API's own hostname: CloudFront validates the endpoint's certificate against it, and the Host header routes to this API.
    domainName: `${api.restApiId}.execute-api.${Stack.of(scope).region}.amazonaws.com`,
    originPath: `/${api.deploymentStage.stageName}`,
    customHeaders: { [ORIGIN_VERIFY_HEADER]: originSecret },
  });
}
