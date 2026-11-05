import { execFile } from 'node:child_process';

/** Ejecuta un script remoto fijo por SSH. Nunca se interpola input de usuario en `script`. */
export type Runner = (script: string, stdin?: string) => Promise<string>;

const TIMEOUT_MS = 20_000;
const MAX_BUFFER = 1024 * 1024;

export const runRemote: Runner = (script, stdin) =>
  new Promise((resolve, reject) => {
    const host = process.env.AVYRA_SSH_HOST || 'avyra';
    const args = ['-o', 'ConnectTimeout=8', '-o', 'BatchMode=yes'];
    if (process.env.AVYRA_SSH_HOSTKEYALIAS) {
      args.push('-o', `HostKeyAlias=${process.env.AVYRA_SSH_HOSTKEYALIAS}`);
    }
    args.push(host, script);
    const child = execFile(
      'ssh',
      args,
      { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const hint =
            ' (¿SSH inaccesible? Si pi.local no resuelve, define AVYRA_SSH_HOST=youruser@192.168.1.x y AVYRA_SSH_HOSTKEYALIAS=pi.local)';
          reject(new Error(`ssh falló: ${String(stderr || err.message).trim().slice(0, 500)}${hint}`));
        } else {
          resolve(stdout);
        }
      },
    );
    child.stdin?.end(stdin);
  });

const PSQL =
  `docker exec -i pradomotica-postgres-1 sh -c 'psql -U avyra_mcp -d "$POSTGRES_DB" -X -q -A -t -v ON_ERROR_STOP=1'`;

/** El SQL viaja por stdin; el comando remoto es constante. */
export async function runSql(sql: string, run: Runner = runRemote): Promise<string> {
  return (await run(PSQL, sql)).trim();
}
