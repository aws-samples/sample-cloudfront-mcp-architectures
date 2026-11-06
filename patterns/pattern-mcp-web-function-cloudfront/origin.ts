import { aws_cloudfront as cloudfront, aws_cloudfront_origins as origins, aws_iam as iam, aws_lambda as lambda, aws_s3 as s3, aws_s3_deployment as s3deploy, Fn, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import { McpAuth } from '../../lib/auth';

export interface WebFunctionOrigin {
  origin: cloudfront.IOrigin;
  // Let this distribution, and nothing else, invoke the endpoint.
  grant(distribution: cloudfront.IDistribution): void;
}

// CloudFront -> Lambda Web Function on its regional (HomeRegion) endpoint.
// The endpoint is IamAuth: CloudFront signs every origin request with SigV4 (OAC), and the function's resource-based
// policy lets only this distribution invoke it, so an unsigned call straight to the endpoint is refused.
export function webFunctionOrigin(scope: Construct, auth: McpAuth): WebFunctionOrigin {
  const { stackName } = Stack.of(scope);
  const functionName = `${stackName}-hello`;
  const fn = new lambda.CfnWebFunction(scope, 'WebFunction', { functionName });

  const role = new iam.Role(scope, 'WebFunctionRole', {
    assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
  });
  const revision = new lambda.CfnWebFunctionRevision(scope, 'WebFunctionRevision', {
    functionName: fn.attrFunctionArn,
    buildConfig: {
      codeConfig: { s3Object: codeBucket(scope, functionName) },
      runtimeConfig: { runtime: 'nodejs24.x' },
    },
    serviceConfig: {
      executionRoleArn: role.roleArn,
      // Nothing in front of the function checks tokens, so the hello server does.
      environmentVariables: { AWS_LAMBDA_NODEJS_ENTRYPOINT: 'server.js', JWT_ISSUER: auth.issuer, JWT_SCOPE: auth.scope, JWT_VERIFY: 'true' },
    },
  });

  const endpoint = new lambda.CfnWebFunctionEndpoint(scope, 'WebFunctionEndpoint', {
    functionName: fn.attrFunctionArn,
    endpointName: 'mcp',
    endpointType: 'HomeRegion', // regional *.lambda-web.<region>.on.aws hostname: OAC signs it with plain SigV4
    authType: 'IamAuth',
    revisionWeights: [{ revisionId: revision.attrRevisionId, weight: 100 }],
  });

  // Lambda Web Function origins support only the always-amz-auth signing behavior, which the CDK L2 does not model yet.
  const oac = new cloudfront.CfnOriginAccessControl(scope, 'WebFunctionOac', {
    originAccessControlConfig: {
      name: `${stackName}-web-function`,
      originAccessControlOriginType: 'lambda',
      signingBehavior: 'always-amz-auth',
      signingProtocol: 'sigv4',
    },
  });

  return {
    origin: new origins.HttpOrigin(endpoint.attrDomainName, { originAccessControlId: oac.attrId }),
    grant(distribution) {
      new lambda.CfnResourcePolicy(scope, 'WebFunctionPolicy', {
        resourceArn: fn.attrFunctionArn,
        policyDocument: {
          Version: '2012-10-17',
          Statement: [{
            Sid: 'AllowCloudFrontOAC',
            Effect: 'Allow',
            Principal: { Service: 'cloudfront.amazonaws.com' },
            Action: 'lambda:InvokeWebFunctionEndpoint',
            Resource: endpoint.attrEndpointArn,
            Condition: { StringEquals: { 'aws:SourceArn': distribution.distributionArn } },
          }],
        },
      });
    },
  };
}

// Web functions run a zip on a managed Node.js runtime, not a container image: ship the same server code.
// Lambda reads the zip with its own service principal, so it needs a versioned bucket whose policy grants it,
// scoped to this function's revisions. The CDK bootstrap bucket cannot carry that policy.
function codeBucket(scope: Construct, functionName: string): { bucket: string; key: string; versionId: string } {
  const { region, account } = Stack.of(scope);
  const bucket = new s3.Bucket(scope, 'WebFunctionCodeBucket', {
    versioned: true,
    enforceSSL: true,
    removalPolicy: RemovalPolicy.DESTROY,
    autoDeleteObjects: true,
  });
  bucket.addToResourcePolicy(new iam.PolicyStatement({
    principals: [new iam.ServicePrincipal('lambda.amazonaws.com')],
    actions: ['s3:GetObject', 's3:GetObjectVersion'],
    resources: [bucket.arnForObjects('*')],
    conditions: { ArnLike: { 'aws:SourceArn': `arn:aws:lambda:${region}:${account}:web-function/${functionName}/revision/*` } },
  }));
  // Copied as one zip (extract off). New code is a new key and so a new revision; prune off keeps the object a live revision pins.
  const deployment = new s3deploy.BucketDeployment(scope, 'WebFunctionCode', {
    sources: [s3deploy.Source.asset(path.join(__dirname, '..', '..', 'server'), { exclude: ['Dockerfile', '*.test.js'] })],
    destinationBucket: bucket,
    extract: false,
    prune: false,
  });
  // The key and version come from the deployment, so the revision waits for the copy.
  return { bucket: bucket.bucketName, key: Fn.select(0, deployment.objectKeys), versionId: Fn.select(0, deployment.objectVersionIds) };
}
