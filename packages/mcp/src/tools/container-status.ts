import type { Runner } from '../remote.ts';

export const inputShape = {};

// Script fijo. Sin `{{json .}}`: incluye `Command` y cloudflared lleva su token en los argumentos.
export const SCRIPT = `
echo '##PS'; docker ps -a --format '{{.Names}}|{{.State}}|{{.Status}}|{{.Image}}'
echo '##INSPECT'; docker inspect --format '{{.Name}}|{{.RestartCount}}|{{.State.StartedAt}}' $(docker ps -aq)
echo '##FREE'; free -m
echo '##DF'; df -P /
echo '##UPTIME'; uptime
echo '##PROC'; ps -eo rss,comm --sort=-rss | head -n 12
`;

export interface Container {
  name: string;
  state: string;
  status: string;
  image: string;
  restartCount: number | null;
  startedAt: string | null;
}

export interface ContainerReport {
  containers: Container[];
  host: {
    memTotalMb: number | null;
    memAvailableMb: number | null;
    diskUsedPct: number | null;
    uptime: string;
    topProcesses: Array<{ rssMb: number; comm: string }>;
  };
  warnings: string[];
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

export function parseContainerOutput(out: string): ContainerReport {
  const s = sections(out);
  const inspect = new Map<string, { restart: number; started: string }>();
  for (const l of s.INSPECT ?? []) {
    const [name, restart, started] = l.split('|');
    if (name) inspect.set(name.replace(/^\//, ''), { restart: Number(restart), started: started ?? '' });
  }
  const containers: Container[] = (s.PS ?? []).map((l) => {
    const [name = '', state = '', status = '', image = ''] = l.split('|');
    const i = inspect.get(name);
    return {
      name,
      state,
      status,
      image,
      restartCount: i && Number.isFinite(i.restart) ? i.restart : null,
      startedAt: i?.started || null,
    };
  });

  const memLine = (s.FREE ?? []).find((l) => l.startsWith('Mem:'))?.split(/\s+/);
  const memTotalMb = memLine ? Number(memLine[1]) : null;
  const memAvailableMb = memLine ? Number(memLine[6]) : null;
  const dfLine = (s.DF ?? [])[1]?.split(/\s+/);
  const diskUsedPct = dfLine ? Number((dfLine[4] ?? '').replace('%', '')) : null;
  const topProcesses = (s.PROC ?? [])
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .map(([rss, comm]) => ({ rssMb: Math.round(Number(rss) / 1024), comm: comm ?? '' }));

  const warnings: string[] = [];
  for (const c of containers) {
    if (c.state !== 'running') warnings.push(`${c.name}: estado ${c.state} (${c.status})`);
    if (c.restartCount && c.restartCount > 0) warnings.push(`${c.name}: ${c.restartCount} reinicios`);
  }
  if (diskUsedPct !== null && Number.isFinite(diskUsedPct) && diskUsedPct > 85)
    warnings.push(`Disco al ${diskUsedPct}%`);
  if (memAvailableMb !== null && Number.isFinite(memAvailableMb) && memAvailableMb < 300)
    warnings.push(`Memoria disponible baja: ${memAvailableMb} MB`);

  return {
    containers,
    host: {
      memTotalMb,
      memAvailableMb,
      diskUsedPct,
      uptime: (s.UPTIME ?? [])[0]?.trim() ?? '',
      topProcesses,
    },
    warnings,
  };
}

export async function containerStatus(run: Runner): Promise<ContainerReport> {
  return parseContainerOutput(await run(SCRIPT));
}
