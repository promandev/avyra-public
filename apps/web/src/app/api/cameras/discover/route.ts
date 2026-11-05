import { networkInterfaces } from 'node:os';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

// Paths conocidos de cámaras IP con firmware yi-hack y alternativas
const SNAPSHOT_PATHS = [
  '/cgi-bin/snapshot.sh',          // yi-hack-Allwinner-v2 (RFUS/IFUS/QFUS)
  '/cgi-bin/camera.jpg',           // yi-hack-MStar
  '/tmp/snapshot.jpg',
  '/cgi-bin/snapshot.jpg',
  '/snapshot.jpg',
  '/image/jpeg.cgi',
  '/cgi-bin/currentpic.cgi',
];
const SCAN_TIMEOUT_MS = 2000;
const BATCH_SIZE = 25;

// Solo escanear rangos privados (no salir a internet ni al propio servidor)
function isPrivateSubnet(subnet: string): boolean {
  const parts = subnet.split('.').map(Number);
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  if (a === 127) return false; // Block localhost/loopback scanning
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function getLocalSubnets(): string[] {
  const nets = networkInterfaces();
  const subnets: string[] = [];
  for (const ifaces of Object.values(nets)) {
    if (!ifaces) continue;
    for (const iface of ifaces) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      const parts = iface.address.split('.');
      const subnet = parts.slice(0, 3).join('.');
      if (isPrivateSubnet(subnet) && !subnets.includes(subnet)) {
        subnets.push(subnet);
      }
    }
  }
  return subnets;
}

async function probeYiHack(ip: string): Promise<{
  ip: string;
  snapshotUrl: string;
  name: string;
  model: string | null;
} | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);

  try {
    // Intentar cada path de snapshot conocido de yi-hack
    for (const path of SNAPSHOT_PATHS) {
      const url = `http://${ip}${path}`;
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: 'image/*' },
        });
        if (res.ok) {
          const ct = res.headers.get('content-type') ?? '';
          if (ct.includes('image')) {
            // Es una cámara. Intentar obtener nombre/modelo de yi-hack
            let name = `Cámara ${ip}`;
            let model: string | null = null;

            try {
              const infoRes = await fetch(
                `http://${ip}/cgi-bin/get_configs.sh?configs=hostname,model`,
                { signal: AbortSignal.timeout(800) },
              );
              if (infoRes.ok) {
                const text = await infoRes.text();
                const hostnameMatch = text.match(/hostname=(.+)/);
                const modelMatch = text.match(/model=(.+)/);
                if (hostnameMatch?.[1]?.trim()) name = hostnameMatch[1].trim();
                if (modelMatch?.[1]?.trim()) model = modelMatch[1].trim();
              }
            } catch {
              // No yi-hack info endpoint — sigue con nombre genérico
            }

            return { ip, snapshotUrl: url, name, model };
          }
        }
      } catch {
        // Esta IP/path no responde — probar el siguiente
      }
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const session = await auth();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const subnets = getLocalSubnets();
  if (subnets.length === 0) {
    return NextResponse.json({ cameras: [], subnets: [] });
  }

  const found: Awaited<ReturnType<typeof probeYiHack>>[] = [];

  for (const subnet of subnets) {
    // Generar IPs del 1 al 254 para esta subred
    const ips = Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`);

    // Escanear en lotes para no saturar la red
    for (let i = 0; i < ips.length; i += BATCH_SIZE) {
      const batch = ips.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(batch.map(probeYiHack));
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) {
          found.push(r.value);
        }
      }
    }
  }

  return NextResponse.json({
    cameras: found,
    subnets,
  });
}
