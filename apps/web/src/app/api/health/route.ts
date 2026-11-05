import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function GET() {
  let go2rtcOk = false;
  try {
    const res = await fetch(`${env.GO2RTC_URL}/api`, {
      signal: AbortSignal.timeout(3000),
    });
    go2rtcOk = res.ok;
  } catch {
    go2rtcOk = false;
  }

  return Response.json({ ok: true, ts: Date.now(), go2rtc: go2rtcOk });
}
