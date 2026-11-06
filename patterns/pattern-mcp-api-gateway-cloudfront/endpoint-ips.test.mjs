import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./endpoint-ips.js', import.meta.url), 'utf8');
// Runs the handler with a fake EC2 client and a fake fetch; returns the reply sent to CloudFormation.
async function run(event, describe) {
  const sent = [];
  const ec2 = { EC2Client: class { send = describe }, DescribeNetworkInterfacesCommand: class { constructor(input) { this.input = input; } } };
  const exports = {};
  new Function('require', 'exports', 'fetch', source)(() => ec2, exports, async (url, init) => { sent.push({ url, init }); return { ok: true }; });
  await exports.handler({ ResponseURL: 'https://cfn.example/r', StackId: 's', RequestId: 'r', LogicalResourceId: 'l', ...event });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].init.headers['content-type'], '');
  return JSON.parse(sent[0].init.body);
}
const props = { NetworkInterfaceIds: ['eni-1', 'eni-2'], EndpointId: 'vpce-1' };

test('create returns each interface IP and the endpoint as the physical ID', async () => {
  const reply = await run({ RequestType: 'Create', ResourceProperties: props }, async (cmd) => {
    assert.deepEqual(cmd.input, { NetworkInterfaceIds: ['eni-1', 'eni-2'] });
    return { NetworkInterfaces: [{ PrivateIpAddress: '10.1.0.10' }, { PrivateIpAddress: '10.1.1.10' }] };
  });
  assert.deepEqual(reply, { Status: 'SUCCESS', PhysicalResourceId: 'vpce-1', StackId: 's', RequestId: 'r', LogicalResourceId: 'l', Data: { Ip0: '10.1.0.10', Ip1: '10.1.1.10' } });
});

test('delete succeeds without calling EC2', async () => {
  const reply = await run({ RequestType: 'Delete', ResourceProperties: props }, async () => assert.fail('no EC2 call on delete'));
  assert.equal(reply.Status, 'SUCCESS');
});

test('an EC2 error fails the resource instead of hanging the stack', async () => {
  const reply = await run({ RequestType: 'Update', ResourceProperties: props }, async () => { throw new Error('denied'); });
  assert.equal(reply.Status, 'FAILED');
  assert.equal(reply.Reason, 'Error: denied');
});
