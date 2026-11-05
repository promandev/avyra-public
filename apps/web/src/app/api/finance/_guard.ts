import { NextResponse } from 'next/server';
import { z } from 'zod';

import { DEBT_KINDS } from '@/lib/finance-types';
import { getSuperAdminSession } from '@/lib/super-admin';
import { isSameOriginRequest } from '@/lib/system-panel';

/**
 * Puerta común de `/api/finance/*`: sólo el super admin, y lo que escribe
 * además desde el propio sitio. Las peticiones JSON exigen `application/json`,
 * que fuerza el preflight si alguien lo intenta desde otro origen.
 */
export async function guard(req: Request, { mutating, json = mutating }: { mutating: boolean; json?: boolean }) {
  const session = await getSuperAdminSession();
  const userId = session?.user?.id;
  if (!userId) {
    return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) } as const;
  }
  if (mutating && !isSameOriginRequest(req)) {
    return { error: NextResponse.json({ error: 'cross_site' }, { status: 403 }) } as const;
  }
  if (json && !req.headers.get('content-type')?.includes('application/json')) {
    return { error: NextResponse.json({ error: 'invalid_request' }, { status: 415 }) } as const;
  }
  return { userId } as const;
}

export const invalid = () => NextResponse.json({ error: 'invalid_request' }, { status: 400 });
export const notFound = () => NextResponse.json({ error: 'not_found' }, { status: 404 });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Hasta 100 millones de euros, en céntimos. */
const cents = z.number().int().min(0).max(10_000_000_000);
const shortText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v ? v : null));

export const debtSchema = z.object({
  name: z.string().trim().min(1).max(80),
  lender: shortText(80),
  kind: z.enum(DEBT_KINDS),
  balanceCents: cents.nullable(),
  balanceAsOf: isoDate,
  monthlyPaymentCents: cents,
  paymentDay: z.number().int().min(1).max(31).nullable(),
  annualRate: z.number().min(0).max(50).nullable(),
  endDate: isoDate.nullable(),
  rateReviewDate: isoDate.nullable(),
  matchText: shortText(120),
  matchAmountCents: cents.nullable(),
  notes: shortText(500),
});

export const recurringSchema = z.object({
  name: z.string().trim().min(1).max(80),
  amountCents: z.number().int().min(-10_000_000_000).max(10_000_000_000),
  dayOfMonth: z.number().int().min(1).max(31).nullable(),
  matchText: shortText(120),
  matchAmountCents: cents.nullable(),
  active: z.boolean(),
});

export const idSchema = z.string().regex(/^[0-9a-f-]{36}$/);
