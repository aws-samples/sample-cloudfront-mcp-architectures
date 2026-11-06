import { aws_cloudfront as cloudfront, aws_cloudfront_origins as origins, aws_ec2 as ec2, aws_eks_v2 as eks, aws_elasticloadbalancingv2 as elbv2, aws_wafv2 as wafv2, Duration } from 'aws-cdk-lib';
import { KubectlV34Layer } from '@aws-cdk/lambda-layer-kubectl-v34';
import { Construct } from 'constructs';
import { McpAuth } from '../../lib/auth';
import { HelloImage } from '../../lib/edge';
import { CLOUDFRONT_ORIGIN_FACING } from '../../lib/vpc';
import { ORIGIN_VERIFY_HEADER } from '../../lib/waf';

export interface EksOriginProps {
  // Built for amd64: the Auto Mode general-purpose node pool runs amd64 instances.
  image: HelloImage;
  originSecret: string;
  originWafArn: string;
  vpc: ec2.IVpc;
  auth: McpAuth;
}

const NAMESPACE = 'mcp';
const APP = 'hello';
const PORT = 8000;

// CloudFront VPC origin -> internal ALB -> MCP server pods on Amazon EKS Auto Mode, in private subnets behind a NAT gateway.
// The ALB, its target group and the VPC origin are created here, so the origin's ARN is stable and owned by this stack.
// In the cluster, a TargetGroupBinding (served by Auto Mode's built-in load balancer controller) registers the pod IPs.
// The hello server checks each token itself: ALB JWT verification needs an HTTPS listener, so a certificate for your own
// domain (see the README).
export function eksOrigin(scope: Construct, { image, originSecret, originWafArn, vpc, auth }: EksOriginProps): cloudfront.IOrigin {
  const cluster = new eks.Cluster(scope, 'Cluster', {
    version: eks.KubernetesVersion.V1_34,
    vpc,
    vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
    defaultCapacityType: eks.DefaultCapacityType.AUTOMODE, // nodes, load balancing and storage managed by EKS
    compute: { nodePools: ['system', 'general-purpose'] },
    kubectlProviderOptions: { kubectlLayer: new KubectlV34Layer(scope, 'Kubectl') }, // applies the manifests below
  });

  // The ALB is private and admits only CloudFront's origin-facing addresses. Pods admit only the ALB.
  const albSecurityGroup = new ec2.SecurityGroup(scope, 'AlbSecurityGroup', { vpc });
  albSecurityGroup.addIngressRule(CLOUDFRONT_ORIGIN_FACING, ec2.Port.tcp(80), 'CloudFront VPC origin');
  cluster.clusterSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(PORT), 'ALB to the MCP server pods');
  const alb = new elbv2.ApplicationLoadBalancer(scope, 'Alb', { // an ALB cannot change VPC: rename it (and its VPC origin) when the VPC is replaced
    vpc,
    internetFacing: false,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    securityGroup: albSecurityGroup,
    idleTimeout: Duration.seconds(60), // at least CloudFront's origin response timeout, so quiet SSE streams are not cut here first
  });
  const targetGroup = new elbv2.ApplicationTargetGroup(scope, 'Targets', {
    vpc,
    port: PORT,
    protocol: elbv2.ApplicationProtocol.HTTP,
    targetType: elbv2.TargetType.IP, // pod IPs, registered by the TargetGroupBinding
    healthCheck: { path: '/', interval: Duration.seconds(15) },
    deregistrationDelay: Duration.seconds(30),
  });
  const listener = alb.addListener('Http', { port: 80, defaultTargetGroups: [targetGroup] });

  // Second WAF layer: blocks anything inside the VPC that calls the ALB without CloudFront's secret header.
  new wafv2.CfnWebACLAssociation(scope, 'AlbWafAssociation', { resourceArn: alb.loadBalancerArn, webAclArn: originWafArn });

  // The MCP server: two stateless pods and a ClusterIP Service, bound to the target group above.
  const labels = { app: APP };
  const manifest = cluster.addManifest('HelloServer',
    { apiVersion: 'v1', kind: 'Namespace', metadata: { name: NAMESPACE } },
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: APP, namespace: NAMESPACE },
      spec: {
        replicas: 2,
        selector: { matchLabels: labels },
        template: {
          metadata: { labels },
          spec: {
            containers: [{
              name: APP,
              image: image.imageUri,
              ports: [{ containerPort: PORT }],
              // The server verifies each token itself (RS256 signature and scope) against the Cognito keys, over the NAT gateway.
              env: [
                { name: 'JWT_ISSUER', value: auth.issuer },
                { name: 'JWT_SCOPE', value: auth.scope },
                { name: 'JWT_VERIFY', value: 'true' },
              ],
              readinessProbe: { httpGet: { path: '/', port: PORT } },
              resources: { requests: { cpu: '250m', memory: '256Mi' } },
            }],
          },
        },
      },
    },
    {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: APP, namespace: NAMESPACE },
      spec: { type: 'ClusterIP', selector: labels, ports: [{ port: 80, targetPort: PORT }] },
    },
    {
      // Auto Mode's load balancer controller registers the Service's pod IPs in the stack's target group. Deleting the
      // Kubernetes objects never deletes the ALB, so the VPC origin always points at an ARN that exists.
      apiVersion: 'eks.amazonaws.com/v1',
      kind: 'TargetGroupBinding',
      metadata: { name: APP, namespace: NAMESPACE },
      spec: { serviceRef: { name: APP, port: 80 }, targetGroupARN: targetGroup.targetGroupArn, targetType: 'ip' },
    },
  );
  manifest.node.addDependency(listener); // the target group must belong to the listener before pods register in it

  // A named VPC origin: CloudFront cannot update one in place while a distribution uses it, so changes replace it.
  const vpcOrigin = new cloudfront.VpcOrigin(scope, 'AlbOrigin', {
    endpoint: cloudfront.VpcOriginEndpoint.applicationLoadBalancer(alb),
    httpPort: 80,
    protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
  });
  return origins.VpcOrigin.withVpcOrigin(vpcOrigin, {
    domainName: alb.loadBalancerDnsName,
    customHeaders: { [ORIGIN_VERIFY_HEADER]: originSecret },
  });
}
