import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containerStatus, SCRIPT } from './container-status.ts';

const sample = (over: { mem?: number; disk?: string; state?: string; restarts?: number } = {}) => `##PS
pradomotica-app-1|running|Up 2 hours|ghcr.io/youruser/avyra-app:latest
pradomotica-caddy-1|${over.state ?? 'running'}|Up 2 hours|caddy:2
##INSPECT
/pradomotica-app-1|0|2026-10-27T10:00:00Z
/pradomotica-caddy-1|${over.restarts ?? 0}|2026-10-27T10:00:00Z
##FREE
              total        used        free      shared  buff/cache   available
Mem:           1800        1000         100          10         700        ${over.mem ?? 800}
##DF
Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/root 100000 50000 50000 ${over.disk ?? '50%'} /
##UPTIME
 10:00:00 up 3 days
##PROC
  RSS COMMAND
204800 node
102400 dockerd
`;

test('sin avisos en estado sano', async () => {
  const r = await containerStatus(async () => sample());
  assert.deepEqual(r.warnings, []);
  assert.equal(r.containers.length, 2);
  assert.equal(r.host.memAvailableMb, 800);
  assert.equal(r.host.diskUsedPct, 50);
  assert.deepEqual(r.host.topProcesses[0], { rssMb: 200, comm: 'node' });
});

test('avisos: contenedor caído, reinicios, disco y memoria', async () => {
  const r = await containerStatus(async () =>
    sample({ state: 'exited', restarts: 3, disk: '91%', mem: 200 }),
  );
  assert.equal(r.warnings.length, 4);
  assert.ok(r.warnings.some((w) => w.includes('exited')));
  assert.ok(r.warnings.some((w) => w.includes('3 reinicios')));
  assert.ok(r.warnings.some((w) => w.includes('91%')));
  assert.ok(r.warnings.some((w) => w.includes('200 MB')));
});

test('el script no usa {{json .}} ni argumentos de proceso', () => {
  assert.ok(!SCRIPT.includes('{{json'));
  assert.ok(SCRIPT.includes('ps -eo rss,comm'));
});
