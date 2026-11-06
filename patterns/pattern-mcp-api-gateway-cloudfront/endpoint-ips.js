// Custom resource: the private IPs of the execute-api VPC endpoint's network interfaces, as attributes Ip0 and Ip1.
// Inline code (CloudFormation ZipFile), so the template needs no CDK asset.
const { EC2Client, DescribeNetworkInterfacesCommand } = require('@aws-sdk/client-ec2');

exports.handler = async (event) => {
  const { NetworkInterfaceIds, EndpointId } = event.ResourceProperties;
  const reply = { Status: 'SUCCESS', PhysicalResourceId: EndpointId, StackId: event.StackId, RequestId: event.RequestId, LogicalResourceId: event.LogicalResourceId, Data: {} };
  try {
    if (event.RequestType !== 'Delete') {
      const { NetworkInterfaces } = await new EC2Client().send(new DescribeNetworkInterfacesCommand({ NetworkInterfaceIds }));
      NetworkInterfaces.forEach((eni, i) => { reply.Data[`Ip${i}`] = eni.PrivateIpAddress; });
    }
  } catch (err) {
    Object.assign(reply, { Status: 'FAILED', Reason: String(err) });
  }
  // The presigned response URL signs no content type, so send none.
  const res = await fetch(event.ResponseURL, { method: 'PUT', headers: { 'content-type': '' }, body: JSON.stringify(reply) });
  if (!res.ok) throw new Error(`response URL answered ${res.status}`);
};
