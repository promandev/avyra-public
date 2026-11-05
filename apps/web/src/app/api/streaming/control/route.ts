import { NextResponse } from 'next/server';
import { z } from 'zod';

import { runAutomationTick } from '@/lib/streaming-automation';
import {
  ControlError,
  exitManual,
  followChannel,
  getPanel,
  selectChannel,
  setAutomationEnabled,
  setPower,
  setViewer,
  startChannelDrops,
  startGame,
} from '@/lib/streaming-control';
import { getSuperAdminSession } from '@/lib/super-admin';
import { isMinerConfigured, MinerUnavailableError } from '@/lib/twitch-miner';

export const dynamic = 'force-dynamic';

/**
 * Mandos de la sección Streaming, reservados al super admin.
 *
 * GET devuelve el panel. POST ejecuta una orden y devuelve su resultado junto
 * al panel ya actualizado, para que la interfaz no dependa del siguiente sondeo
 * para reflejar el cambio. Esta ruta estática gana al proxy `[...path]`.
 */

const commandSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('power'), on: z.boolean() }),
  z.object({ op: z.literal('game'), game: z.string().min(1).max(200) }),
  z.object({ op: z.literal('channelDrops'), login: z.string().min(1).max(200) }),
  z.object({ op: z.literal('channel'), channelId: z.number().int().positive() }),
  z.object({ op: z.literal('auto'), enabled: z.boolean() }),
  z.object({ op: z.literal('viewer'), on: z.boolean() }),
  z.object({ op: z.literal('follow'), login: z.string().min(1).max(200) }),
  z.object({ op: z.literal('tick') }),
  z.object({ op: z.literal('exitManual') }),
]);

type Command = z.infer<typeof commandSchema>;

/** Órdenes que hablan con el minero de drops y no tienen sentido sin él. */
const NEEDS_MINER = new Set<Command['op']>(['power', 'game', 'channelDrops', 'channel', 'exitManual']);

async function execute(command: Command): Promise<unknown> {
  switch (command.op) {
    case 'power':
      return setPower(command.on);
    case 'game':
      return startGame(command.game);
    case 'channelDrops':
      return startChannelDrops(command.login);
    case 'channel':
      return selectChannel(command.channelId);
    case 'auto':
      await setAutomationEnabled(command.enabled);
      return { enabled: command.enabled };
    case 'viewer':
      return setViewer(command.on);
    case 'follow':
      return followChannel(command.login);
    case 'tick':
      return runAutomationTick();
    case 'exitManual':
      return exitManual();
    default: {
      const unreachable: never = command;
      return unreachable;
    }
  }
}

export async function GET() {
  if (!(await getSuperAdminSession())) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return NextResponse.json(await getPanel());
}

export async function POST(req: Request) {
  if (!(await getSuperAdminSession())) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const parsed = commandSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Orden no válida' }, { status: 400 });
  }

  // El seguimiento funciona sin el minero de drops configurado; sus órdenes no.
  if (NEEDS_MINER.has(parsed.data.op) && !isMinerConfigured()) {
    return NextResponse.json({ error: 'miner_not_configured' }, { status: 503 });
  }

  try {
    const result = await execute(parsed.data);
    return NextResponse.json({ result, panel: await getPanel() });
  } catch (err) {
    if (err instanceof ControlError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof MinerUnavailableError) {
      return NextResponse.json(
        { error: 'miner_unavailable', detail: err.message },
        { status: 503 },
      );
    }
    console.error('[streaming] Control failed:', parsed.data.op, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error desconocido' },
      { status: 500 },
    );
  }
}
