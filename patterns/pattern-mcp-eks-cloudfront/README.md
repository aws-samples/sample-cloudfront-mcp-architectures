# Amazon EKS behind CloudFront

CloudFront → VPC origin → internal Application Load Balancer → MCP server pods on an Amazon EKS Auto Mode cluster, in
private subnets behind one NAT gateway.

The container-platform shape, with no public origin to protect. The ALB has only private IPs, its security group admits
only CloudFront's origin-facing addresses, and it carries the regional web ACL, so a workload inside the VPC cannot skip
the edge rules either. EKS Auto Mode provisions the nodes and runs the load balancer controller, so the stack installs
no add-ons. It costs while idle: the cluster, its nodes, the ALB and the NAT gateway. Deploying takes about 20 minutes.

![EKS pattern: the edge (AWS WAF, the distribution, the CloudFront Function) and the Region (regional AWS WAF on the internal ALB, the Auto Mode cluster with the MCP server pods, the NAT gateway, Amazon Cognito and the origin secret), numbered as below](../../docs/diagrams/pattern-mcp-eks-cloudfront/pattern-mcp-eks-cloudfront.svg)

1. **AWS WAF at the edge** runs the MCP rule stack ([root README](../../README.md#aws-waf-at-the-edge)) before
   anything else, so floods and malformed requests never use cluster capacity.
2. **The CloudFront distribution** sends allowed requests through a
   [VPC origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html)
   to the ALB over HTTP on port 80 inside the AWS network, with the secret `x-origin-verify` header (9) added. Use HTTPS
   with a certificate for your own domain if your rules require encryption to the origin.
3. **The CloudFront Function** decodes the Bearer token and answers `401` at the edge for a missing, malformed, expired
   or foreign token. For a good token it sets `x-jwt-claims` for the regional web ACL (4) and `x-forwarded-host` for
   the server's metadata.
4. **AWS WAF on the ALB** (`OriginWaf`) admits only requests with the secret header and an `mcp/` scope in
   `x-jwt-claims`. The security group proves a request came from CloudFront. This proves it came through *this*
   distribution and its edge rules, and it catches anything inside the VPC that calls the ALB directly. An ALB inspects
   only the first 8 KB of a body and this web ACL has no size preflight, so its argument rules block a body they cannot
   fully see. If the network lock is enough for you, an ALB listener rule on the header does the same with less.
5. **The internal ALB** has private IPs only. Its security group admits port 80 only from the CloudFront managed prefix
   list `com.amazonaws.global.cloudfront.origin-facing`. The cluster security group admits port 8000 only from the ALB.
   The stack creates the ALB, its listener and a target group of type `ip`, so the VPC origin points at an ARN this
   stack owns. ALB JWT verification (`authenticateJwt`) would be the native token check, but it works only on HTTPS
   listeners, which need a certificate for your own domain. With one, move the check here.
6. **The MCP server pods** are a two-replica Deployment of the hello image (built for amd64, which Auto Mode's
   general-purpose node pool runs) in namespace `mcp`, with a ClusterIP Service and a readiness probe on `/`. A
   `TargetGroupBinding` (`eks.amazonaws.com/v1`, served by Auto Mode's built-in load balancer controller) registers the
   pod IPs in the stack's target group. Deleting the Kubernetes objects never deletes the ALB. The server verifies each
   token's RS256 signature and the `mcp/eks` scope itself ([server/auth.js](../../server/auth.js)). The server is
   stateless Streamable HTTP, so any pod can answer any call and the ALB needs no stickiness.
7. **The NAT gateway** gives the private subnets egress: nodes pull the image from Amazon ECR and the pods fetch the
   Cognito keys through it. The cluster is Kubernetes 1.34 with the `system` and `general-purpose` node pools. The CDK
   applies the manifests through its kubectl provider.
8. **Amazon Cognito** issues the tokens and publishes the keys the pods verify against.
9. **Secrets Manager** holds the random `x-origin-verify` value, read at deploy into the origin header (2) and the
   `OriginWaf` rule (4). Rotate it by updating the secret and redeploying.

## Deploy

```bash
npm ci                                  # at the repository root, once
cd patterns/pattern-mcp-eks-cloudfront
npx cdk deploy
```

Needs Docker for the image. Then get a token with scope `mcp/eks` and call `hello` as in the
[root README](../../README.md#deploy). `kubectl` access to the cluster is not needed. To look inside, create an access
entry for your IAM principal with `aws eks create-access-entry` and `aws eks update-kubeconfig`.
