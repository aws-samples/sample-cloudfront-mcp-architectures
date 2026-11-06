import { aws_ec2 as ec2 } from 'aws-cdk-lib';
import { Construct } from 'constructs';

// Managed prefix list com.amazonaws.global.cloudfront.origin-facing. The ID differs per Region; the stacks are pinned to us-east-1.
// aws ec2 describe-managed-prefix-lists --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing
// CloudFront VPC origin traffic keeps these source IPs, so private origins allow this list, not the VPC CIDR.
export const CLOUDFRONT_ORIGIN_FACING = ec2.Peer.prefixList('pl-3b927c52');

export interface McpVpcProps {
  // 0: isolated subnets, for origins that need no internet egress. 1: private subnets behind one NAT gateway.
  natGateways: 0 | 1;
}

// The VPC for a private origin: two Availability Zones, no NAT gateway unless asked for. CloudFront VPC origins require an
// internet gateway on the VPC, so it has public subnets even when nothing runs in them.
export function mcpVpc(scope: Construct, { natGateways }: McpVpcProps): ec2.Vpc {
  return new ec2.Vpc(scope, 'Vpc', {
    maxAzs: 2,
    ipAddresses: ec2.IpAddresses.cidr('10.1.0.0/16'),
    natGateways,
    subnetConfiguration: [
      { name: 'public', subnetType: ec2.SubnetType.PUBLIC },
      { name: 'private', subnetType: natGateways ? ec2.SubnetType.PRIVATE_WITH_EGRESS : ec2.SubnetType.PRIVATE_ISOLATED },
    ],
  });
}
