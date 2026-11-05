#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { env, platform } from 'node:process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function ensureWindowsSystemPath(pathValue) {
  const normalized = pathValue.split(';').map((p) => p.trim()).filter(Boolean);
  const needed = ['C:\\Windows\\System32', 'C:\\Windows'];
  for (const candidate of needed) {
    if (!normalized.some((p) => p.toLowerCase() === candidate.toLowerCase())) {
      normalized.push(candidate);
    }
  }
  return normalized.join(';');
}

async function runCommand(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      stdio: 'inherit',
      env: { ...env },
    });

    child.on('close', (code, signal) => {
      if (signal) {
        reject(new Error(`Command terminated by signal ${signal}`));
      } else if (code !== 0) {
        reject(new Error(`Command exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

async function getTcpListeners(ports) {
  if (platform !== 'win32') return [];
  return new Promise((resolve) => {
    const netstat = spawn('netstat', ['-ano'], { shell: true, env: { ...env }, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    netstat.stdout.on('data', (chunk) => { output += chunk.toString(); });
    netstat.on('close', () => {
      const lines = output.split(/\r?\n/);
      const results = [];
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5 || parts[0] !== 'TCP') continue;
        const local = parts[1];
        const state = parts[3];
        const pid = parseInt(parts[4], 10);
        const match = local.match(/^(.*):(\d+)$/);
        if (!match) continue;
        const port = Number(match[2]);
        if (ports.includes(port)) {
          results.push({ port, state, pid });
        }
      }
      resolve(results);
    });
  });
}

async function killStaleDevProcess(pid) {
  if (platform !== 'win32') return;
  return runCommand(`taskkill /F /PID ${pid} /T`).catch(() => {});
}

async function cleanupStaleProcesses() {
  if (platform !== 'win32') return;
  await runCommand('taskkill /F /IM postgres.exe /T').catch(() => {});
  await runCommand('taskkill /F /IM go2rtc.exe /T').catch(() => {});

  const ports = [3000, 1984, 8554, 15432];
  const listeners = await getTcpListeners(ports);
  const killed = new Set();
  for (const listener of listeners) {
    if (!listener.pid || killed.has(listener.pid)) continue;
    await killStaleDevProcess(listener.pid);
    killed.add(listener.pid);
  }
}

async function isLocalDatabase() {
  const dbUrl = env.DATABASE_URL ?? '';
  try {
    const parsed = new URL(dbUrl);
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return true; // si no se puede parsear, asumimos local por seguridad
  }
}

async function main() {
  if (platform === 'win32') {
    env.PATH = ensureWindowsSystemPath(env.PATH || '');
  }

  const localDb = await isLocalDatabase();

  if (localDb) {
    await cleanupStaleProcesses();
  } else {
    console.log('ℹ  DATABASE_URL apunta a una BD remota — omitiendo PostgreSQL embebido.');
    // Solo matar go2rtc/next que pudieran estar colgados
    if (platform === 'win32') {
      await runCommand('taskkill /F /IM go2rtc.exe /T').catch(() => {});
      const ports = [3000, 1984, 8554];
      const listeners = await getTcpListeners(ports);
      const killed = new Set();
      for (const listener of listeners) {
        if (!listener.pid || killed.has(listener.pid)) continue;
        await killStaleDevProcess(listener.pid);
        killed.add(listener.pid);
      }
    }
  }

  const dbProcess = localDb
    ? '"pnpm dev:db"'
    : '"echo [db] Usando BD remota — no se arranca postgres embebido"';

  const command = `npx concurrently --names "db,go2rtc,next" --restart-tries 5 --restart-after 2000 ${dbProcess} ".\\infra\\go2rtc\\go2rtc.exe -config .\\infra\\go2rtc\\go2rtc.yaml" "pnpm --filter @pradomotica/web dev"`;
  try {
    await runCommand(command);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

main();
