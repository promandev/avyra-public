import { clientIp, logPanelEvent } from '@/lib/system-panel';
import { openDownload } from '@/lib/system-files';
import { fileErrorResponse, guard } from '../../_guard';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const gate = await guard(req, { mutating: false });
  if ('error' in gate) return gate.error;

  const target = new URL(req.url).searchParams.get('path') ?? '';
  try {
    const file = await openDownload(target);
    await logPanelEvent(
      `DESCARGAR ${file.path} usuario=${gate.session.user?.email ?? '?'} ip=${clientIp(req)}`,
    );
    return new Response(file.stream, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(file.size),
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    return fileErrorResponse(err);
  }
}
