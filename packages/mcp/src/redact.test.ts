import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, redactString } from './redact.ts';

const R = '[REDACTED]';

test('github tokens', () => {
  assert.equal(redactString('x ghp_' + 'a'.repeat(36)), `x ${R}`);
  assert.equal(redactString('github_pat_' + 'A1_'.repeat(10)), R);
});

test('jwt', () => {
  assert.equal(redactString('t=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcDEF123'), `t=${R}`);
});

test('bearer', () => {
  assert.equal(redactString('Authorization: Bearer abc123def456'), `Authorization: Bearer ${R}`);
});

test('credenciales en URL (rtsp)', () => {
  assert.equal(redactString('rtsp://admin:s3cret@192.168.1.x/ch0'), `rtsp://${R}@192.168.1.x/ch0`);
  assert.equal(redactString('https://u:p@host/x'), `https://${R}@host/x`);
});

test('KEY=valor', () => {
  assert.equal(redactString('HA_TOKEN=abc'), `HA_TOKEN=${R}`);
  assert.equal(redactString('db_password: "hunter2"'), `db_password: ${R}`);
  assert.equal(redactString('PATH=/usr/bin'), 'PATH=/usr/bin');
});

test('bloque de clave privada', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----';
  assert.equal(redactString(`a ${pem} b`), `a ${R} b`);
});

test('hex y base64 largos', () => {
  assert.equal(redactString('id ' + 'ab12'.repeat(8)), `id ${R}`);
  assert.equal(redactString('k ' + 'Zm9vYmFy'.repeat(5) + '=='), `k ${R}`);
  assert.equal(redactString('corto abc123'), 'corto abc123');
});

test('recursivo en objetos y arrays', () => {
  const out = redact({ a: ['TOKEN=zzz'], b: { c: 'rtsp://u:p@h/x' }, n: 3 });
  assert.deepEqual(out, { a: [`TOKEN=${R}`], b: { c: `rtsp://${R}@h/x` }, n: 3 });
});
