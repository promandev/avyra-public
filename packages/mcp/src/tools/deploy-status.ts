import { execFile } from 'node:child_process';
import type { Runner } from '../remote.ts';

export const inputShape = {};

/** Ejecuta git local con argumentos fijos (nunca input de usuario). */
export type GitRunner = (args: string[]) => Promise<string>;

export const runGit: GitRunner = (args) =>
  new Promise((resolve, reject) => {
    execFile('git', args, { timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true }, (err, stdout, stderr) =>
      err ? reject(new Error(`git ${args[0]} falló: ${String(stderr || err.message).trim()}`)) : resolve(stdout),
    );
  });

export const SCRIPT = `
echo '##VERSION'; docker exec pradomotica-app-1 node -p "require('/app/apps/web/package.json').version"
echo '##CONTAINER'; docker inspect --format '{{.State.Status}}|{{.State.StartedAt}}|{{.RestartCount}}|{{.Image}}' pradomotica-app-1
echo '##IMAGE'; docker image inspect --format '{{.Id}}|{{.Created}}' ghcr.io/youruser/avyra-app:latest
echo '##LOG'; tail -n 15 /home/youruser/auto-deploy-app.log
`;

export type Verdict = 'up_to_date' | 'behind' | 'image_pulled_not_running' | 'restarting' | 'unknown';

export interface DeployReport {
  verdict: Verdict;
  deployedVersion: string | null;
  masterVersion: string | null;
  master: { sha: string; date: string } | null;
  container: { status: string; startedAt: string; restartCount: number; imageId: string } | null;
  latestImage: { id: string; created: string } | null;
  autoDeployLog: string[];
  notes: string[];
}

function sections(out: string): Record<string, string[]> {
  const res: Record<string, string[]> = {};
  let cur: string | null = null;
  for (const line of out.split('\n')) {
    const m = /^##(\w+)$/.exec(line.trim());
    if (m) {
      cur = m[1]!;
      res[cur] = [];
    } else if (cur && line.trim()) res[cur]!.push(line);
  }
  return res;
}

function parseSemver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** <0 si a<b, 0 si iguales, >0 si a>b; null si alguna no es semver. */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  return 0;
}

export function computeVerdict(p: {
  deployedVersion: string | null;
  masterVersion: string | null;
  containerStatus: string | null;
  containerImageId: string | null;
  latestImageId: string | null;
}): Verdict {
  if (p.containerStatus === 'created' || p.containerStatus === 'restarting') return 'restarting';
  if (p.containerImageId && p.latestImageId && p.containerImageId !== p.latestImageId) {
    return 'image_pulled_not_running';
  }
  if (p.deployedVersion && p.masterVersion) {
    const c = compareVersions(p.deployedVersion, p.masterVersion);
    if (c === null) return 'unknown';
    return c < 0 ? 'behind' : 'up_to_date';
  }
  return 'unknown';
}

export async function deployStatus(
  input: { fetch?: boolean },
  run: Runner,
  git: GitRunner = runGit,
): Promise<DeployReport> {
  const notes = ['El estado del CI (GitHub Actions) no está disponible sin gh.'];

  const [remoteOut, local] = await Promise.all([
    run(SCRIPT),
    (async () => {
      try {
        if (input.fetch) await git(['fetch', 'origin', 'master']);
        const pkg = JSON.parse(await git(['show', 'origin/master:apps/web/package.json'])) as { version?: string };
        const info = (await git(['log', '-1', '--format=%h|%cI', 'origin/master'])).trim().split('|');
        return { version: pkg.version ?? null, sha: info[0] ?? '', date: info[1] ?? '' };
      } catch (e) {
        notes.push(`No se pudo leer origin/master: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    })(),
  ]);

  const s = sections(remoteOut);
  const deployedVersion = s.VERSION?.[0]?.trim() || null;
  const [cStatus, cStarted, cRestarts, cImage] = (s.CONTAINER?.[0] ?? '').split('|');
  const container = cStatus
    ? { status: cStatus, startedAt: cStarted ?? '', restartCount: Number(cRestarts ?? 0), imageId: cImage ?? '' }
    : null;
  const [imgId, imgCreated] = (s.IMAGE?.[0] ?? '').split('|');
  const latestImage = imgId ? { id: imgId, created: imgCreated ?? '' } : null;

  const verdict = computeVerdict({
    deployedVersion,
    masterVersion: local?.version ?? null,
    containerStatus: container?.status ?? null,
    containerImageId: container?.imageId ?? null,
    latestImageId: latestImage?.id ?? null,
  });
  if (verdict === 'restarting') notes.push('El contenedor se está recreando: vuelve a comprobar en un minuto, no es un crash.');
  if (verdict === 'image_pulled_not_running') notes.push('La imagen nueva ya está descargada; el cron (cada 5 min) recreará el contenedor.');
  if (verdict === 'behind') notes.push('Si acabas de hacer push, el build de GitHub Actions y el cron tardan unos minutos.');

  return {
    verdict,
    deployedVersion,
    masterVersion: local?.version ?? null,
    master: local ? { sha: local.sha, date: local.date } : null,
    container,
    latestImage,
    autoDeployLog: s.LOG ?? [],
    notes,
  };
}
