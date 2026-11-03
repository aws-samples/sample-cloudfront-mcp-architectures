# End-to-end evidence

`cfn.sh STACK PATTERN [aws-profile]` calls one pattern deployed from its template in `cfn/` and replaces the account
ID, stack UUIDs and the token in its output.

## Plain CloudFormation: one pattern from its template

- `cfn-alb.txt`, `cfn-api-gateway.txt`, `cfn-web-function.txt`: each a throwaway stack deployed with
  `aws cloudformation deploy` from `cfn/<pattern>.yaml`, with no CDK and no bootstrap: the hello image pushed to a new
  ECR repository (ALB, API Gateway), the server zip uploaded to a new versioned bucket (web function), as the pattern
  READMEs describe. A token from Amazon Cognito client credentials with the pattern's scope gets `tools/list` and
  `Hello, cloudformation` through the pattern's distribution; no token gets `401` from the CloudFront Function. The API
  Gateway run also proves the inline custom resource that looks up the execute-api endpoint IPs for the NLB. The stacks
  were deleted afterwards.
- `cfn-agentcore.txt`: the same for pattern 1, deployed in the same account as a CDK stack: the Runtime, Gateway and
  CloudFront Function names come from the stack name, so they do not collide. `tools/list` returns `hello___hello` and
  `tools/call` returns `Hello, cloudformation` through the Gateway; no token gets `401`. The stack and its ECR
  repository were deleted afterwards.

These runs predate the removal of the demo page from this repository, so the templates they deployed also carried a
CORS preflight rule (`AllowCorsPreflight`) in the edge web ACL and a `DemoClient` app client; the checks above are
unaffected.
