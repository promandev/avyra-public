import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSql, cameraDiagLogTool, inputSchema } from './camera-diag-log.ts';

test('defaults', () => {
  const i = inputSchema.parse({});
  assert.deepEqual(i, { hours: 72, level: 'warn', limit: 100 });
});

test('rechaza cameraId con comillas o ;', () => {
  for (const bad of ["x'; DROP TABLE users;--", 'a;b', "a'b", 'a b', '', 'x'.repeat(65)]) {
    assert.equal(inputSchema.safeParse({ cameraId: bad }).success, false, bad);
  }
  assert.equal(inputSchema.safeParse({ cameraId: 'cam_1-A' }).success, true);
});

test('rechaza hours, level y limit fuera de rango', () => {
  assert.equal(inputSchema.safeParse({ hours: 5 }).success, false);
  assert.equal(inputSchema.safeParse({ level: 'debug' }).success, false);
  assert.equal(inputSchema.safeParse({ limit: 401 }).success, false);
  assert.equal(inputSchema.safeParse({ limit: 0 }).success, false);
});

test('construye el SQL esperado', () => {
  const sql = buildSql(inputSchema.parse({ level: 'error', hours: 24, cameraId: 'abc', limit: 5 }));
  assert.ok(sql.includes('make_interval(hours => 24)'));
  assert.ok(sql.includes("l.level IN ('error')"));
  assert.ok(sql.includes("l.device_id = 'abc'"));
  assert.ok(sql.includes('LIMIT 5'));
  assert.ok(!sql.includes('user_id'));
  const all = buildSql(inputSchema.parse({ level: 'all' }));
  assert.ok(all.includes("'error','warn','info'"));
  assert.ok(!all.includes('l.device_id ='));
});

test('parsea la fila JSON del runner', async () => {
  let sent = '';
  const run = async (_s: string, stdin?: string) => {
    sent = stdin ?? '';
    return '{"cameras":[{"id":"a","name":"Salón"}],"summary":[],"rows":[]}\n';
  };
  const r = await cameraDiagLogTool(inputSchema.parse({}), run);
  assert.equal(r.cameras[0]?.name, 'Salón');
  assert.ok(sent.startsWith('SELECT'));
});
