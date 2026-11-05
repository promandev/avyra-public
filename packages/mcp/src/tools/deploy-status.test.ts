import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeVerdict, compareVersions, deployStatus } from './deploy-status.ts';

const base = {
  deployedVersion: '0.14.0',
  masterVersion: '0.14.0',
  containerStatus: 'running',
  containerImageId: 'sha256:aaa',
  latestImageId: 'sha256:aaa',
};

test('veredictos', () => {
  assert.equal(computeVerdict(base), 'up_to_date');
  assert.equal(computeVerdict({ ...base, deployedVersion: '0.13.2' }), 'behind');
  assert.equal(computeVerdict({ ...base, latestImageId: 'sha256:bbb' }), 'image_pulled_not_running');
  assert.equal(computeVerdict({ ...base, containerStatus: 'created' }), 'restarting');
  assert.equal(computeVerdict({ ...base, containerStatus: 'restarting' }), 'restarting');
  assert.equal(computeVerdict({ ...base, masterVersion: null }), 'unknown');
  assert.equal(computeVerdict({ ...base, deployedVersion: 'x' }), 'unknown');
});

test('compareVersions', () => {
  assert.ok(compareVersions('0.9.0', '0.10.0')! < 0);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('a', '1.0.0'), null);
});

test('deployStatus de extremo a extremo con runners inyectados', async () => {
  const remote = `##VERSION
0.13.2
##CONTAINER
running|2026-10-27T10:00:00Z|0|sha256:aaa
##IMAGE
sha256:aaa|2026-10-27T09:00:00Z
##LOG
2026-10-27 up to date
`;
  const git = async (args: string[]) =>
    args[0] === 'show' ? '{"version":"0.14.0"}' : 'abc1234|2026-10-27T08:00:00+00:00\n';
  const r = await deployStatus({}, async () => remote, git);
  assert.equal(r.verdict, 'behind');
  assert.equal(r.deployedVersion, '0.13.2');
  assert.equal(r.masterVersion, '0.14.0');
  assert.equal(r.master?.sha, 'abc1234');
  assert.equal(r.autoDeployLog.length, 1);
});

test('fetch solo se ejecuta si se pide', async () => {
  const calls: string[] = [];
  const git = async (args: string[]) => {
    calls.push(args[0]!);
    return args[0] === 'show' ? '{"version":"1.0.0"}' : 'x|y';
  };
  await deployStatus({}, async () => '', git);
  assert.ok(!calls.includes('fetch'));
  await deployStatus({ fetch: true }, async () => '', git);
  assert.ok(calls.includes('fetch'));
});
