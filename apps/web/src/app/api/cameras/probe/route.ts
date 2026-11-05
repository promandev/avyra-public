import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

// Todos los paths conocidos de cámaras IP (yi-hack, stock Yi, Xiaomi, genéricos)
const PROBE_PATHS = [
  // yi-hack-Allwinner-v2 (RFUS/IFUS/QFUS models)
  { path: '/cgi-bin/snapshot.sh', label: 'yi-hack snapshot (Allwinner)' },
  { path: '/cgi-bin/snapshot.sh?res=high', label: 'yi-hack snapshot high (Allwinner)' },
  { path: '/cgi-bin/snapshot.sh?res=low', label: 'yi-hack snapshot low (Allwinner)' },
  // yi-hack-MStar (y25/y23/y203c models)
  { path: '/cgi-bin/camera.jpg', label: 'yi-hack snapshot (MStar)' },
  { path: '/tmp/snapshot.jpg', label: 'yi-hack tmp snapshot' },
  { path: '/cgi-bin/snapshot.jpg', label: 'yi-hack cgi snapshot' },
  // Stock Yi / Xiaomi
  { path: '/snapshot.jpg', label: 'stock snapshot' },
  { path: '/image/jpeg.cgi', label: 'Xiaomi MJPEG' },
  { path: '/cgi-bin/currentpic.cgi', label: 'currentpic' },
  // Generic ONVIF / RTSP previews
  { path: '/onvif/snapshot', label: 'ONVIF snapshot' },
  { path: '/web/auto.jpg', label: 'generic web auto' },
  // Raíz HTTP (detectar si hay servidor)
  { path: '/', label: 'HTTP root' },
];

const PROBE_TIMEOUT_MS = 3000;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return new NextResponse('Unauthorized', { status: 401 });

  const ip = req.nextUrl.searchParams.get('ip');
  if (!ip || !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
    return NextResponse.json({ error: 'IP inválida' }, { status: 400 });
  }

  // Validar que sea una IP privada
  const parts = ip.split('.').map(Number);
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  const isPrivate =
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168);

  if (!isPrivate) {
    return NextResponse.json({ error: 'Solo se permiten IPs privadas' }, { status: 400 });
  }

  const results: {
    path: string;
    label: string;
    status: number | null;
    contentType: string | null;
    isImage: boolean;
    error: string | null;
  }[] = [];

  // Probar todos los paths en paralelo
  await Promise.allSettled(
    PROBE_PATHS.map(async ({ path, label }) => {
      const url = `http://${ip}${path}`;
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
          headers: { Accept: '*/*' },
        });
        const contentType = res.headers.get('content-type') ?? '';
        results.push({
          path,
          label,
          status: res.status,
          contentType,
          isImage: contentType.includes('image') || contentType.includes('jpeg'),
          error: null,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({
          path,
          label,
          status: null,
          contentType: null,
          isImage: false,
          error: msg.includes('abort') || msg.includes('timeout')
            ? 'timeout (sin respuesta)'
            : msg.includes('ECONNREFUSED')
              ? 'puerto cerrado'
              : msg.includes('ECONNRESET')
                ? 'conexión rechazada'
                : msg,
        });
      }
    }),
  );

  const found = results.find((r) => r.isImage);
  const reachable = results.some((r) => r.status !== null);

  return NextResponse.json({
    ip,
    reachable,
    snapshotFound: !!found,
    snapshotUrl: found ? `http://${ip}${found.path}` : null,
    results: results.sort((a, b) => {
      // Poner primero los que respondieron con imagen, luego los que respondieron, luego timeouts
      if (a.isImage && !b.isImage) return -1;
      if (!a.isImage && b.isImage) return 1;
      if (a.status !== null && b.status === null) return -1;
      if (a.status === null && b.status !== null) return 1;
      return 0;
    }),
  });
}
