#!/usr/bin/env bash
# End-to-end check of one pattern deployed from its template in cfn/ with plain CloudFormation: a token from Amazon
# Cognito, then tools/list and tools/call hello through the pattern's distribution.
# Usage: docs/e2e/cfn.sh STACK PATTERN [aws-profile]   PATTERN: agentcore | api-gateway | web-function | alb
# Output has the account ID, stack UUIDs and the token replaced; save it as evidence.
set -uo pipefail
stack=$1 pattern=$2
profile=(${3:+--profile "$3"})
aws=(aws "${profile[@]}" --region us-east-1)
account=$("${aws[@]}" sts get-caller-identity --query Account --output text)
out() { "${aws[@]}" cloudformation describe-stacks --stack-name "$stack" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
case $pattern in
  agentcore) output=AgentCoreMcp tool=hello___hello ;;
  api-gateway) output=ApiGatewayMcp tool=hello ;;
  web-function) output=WebFunctionMcp tool=hello ;;
  alb) output=AlbMcp tool=hello ;;
  *) echo "unknown pattern $pattern" >&2; exit 2 ;;
esac
mcp() { # mcp BODY [extra curl args...]
  local body=$1; shift
  echo "\$ curl -X POST $url $* -d '$body'" | sed 's/Bearer [^ ]*/Bearer <token>/'
  curl -sS -m 20 -X POST "$url" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
    -H 'mcp-protocol-version: 2025-11-25' "$@" -d "$body" -w '\nHTTP %{http_code}\n' 2>&1 | grep -v '^x-mcp-waf-request-id'
  echo
}

url=$(out $output) client=$(out ClientId)
{
  echo "# $(date -u +%Y-%m-%dT%H:%M:%SZ) stack $stack from cfn/$pattern.yaml"
  echo "## Stack status, tags and parameters"
  "${aws[@]}" cloudformation describe-stacks --stack-name "$stack" --query 'Stacks[0].{Status: StackStatus, Tags: Tags, Parameters: Parameters}' --output json
  echo "## Outputs"
  "${aws[@]}" cloudformation describe-stacks --stack-name "$stack" --query 'Stacks[0].Outputs[].[OutputKey, OutputValue]' --output text
  echo
  echo "## Token: client credentials for scope mcp/$pattern, the client secret read with describe-user-pool-client"
  secret=$("${aws[@]}" cognito-idp describe-user-pool-client --user-pool-id "$(out UserPoolId)" --client-id "$client" --query UserPoolClient.ClientSecret --output text)
  token=$(curl -sS -m 10 -u "$client:$secret" -d grant_type=client_credentials -d "scope=mcp/$pattern" "$(out TokenUrl)" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
  node -e 'console.log(Buffer.from(process.argv[1].split(".")[1], "base64url").toString())' "$token"; echo
  echo "## tools/list: expect $tool"
  mcp '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' -H "authorization: Bearer $token"
  echo "## tools/call $tool name=cloudformation: expect Hello"
  mcp "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"$tool\",\"arguments\":{\"name\":\"cloudformation\"}}}" -H "authorization: Bearer $token" -D - 
  echo "## No token: expect 401 from the CloudFront Function"
  mcp "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"$tool\",\"arguments\":{\"name\":\"x\"}}}" -D -
} 2>&1 | sed -e "s/$account/<account>/g" -e 's/[0-9a-f]\{8\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{12\}/<uuid>/g' \
  -e 's/"sub": *"[^"]*"/"sub":"<client>"/; s/"client_id": *"[^"]*"/"client_id":"<client>"/' -e "s/$client/<client>/g"
