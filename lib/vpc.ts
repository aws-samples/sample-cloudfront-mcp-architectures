import { aws_ec2 as ec2 } from 'aws-cdk-lib';
import { Construct } from 'constructs';

// Managed prefix list com.amazonaws.global.cloudfront.origin-facing. The ID differs per Region; the stack is pinned to us-east-1.
// aws ec2 describe-managed-prefix-lists --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing
// CloudFront VPC origin traffic keeps these source IPs, so private origins allow this list, not the VPC CIDR.
export const CLOUDFRONT_ORIGIN_FACING = ec2.Peer.prefixList('pl-3b927c52');

// One VPC for every private origin: two AZs, isolated subnets, no NAT.
// The AZs are pinned because cognito-idp interface endpoints exist only in some of them. AZ names map to different physical
// AZs in each account; check yours with
// aws ec2 describe-vpc-endpoint-services --service-names com.amazonaws.us-east-1.cognito-idp --query 'ServiceDetails[0].AvailabilityZones'
export function sharedVpc(scope: Construct): ec2.Vpc {
  return new ec2.Vpc(scope, 'Vpc', {
    availabilityZones: ['us-east-1b', 'us-east-1c'],
    ipAddresses: ec2.IpAddresses.cidr('10.1.0.0/16'),
    natGateways: 0,
    subnetConfiguration: [
      // CloudFront VPC origins require an internet gateway on the VPC; nothing runs in these subnets.
      { name: 'public', subnetType: ec2.SubnetType.PUBLIC },
      { name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    ],
    gatewayEndpoints: { S3: { service: ec2.GatewayVpcEndpointAwsService.S3 } }, // ECR image layers
  });
}
