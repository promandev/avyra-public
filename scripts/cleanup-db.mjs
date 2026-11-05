/**
 * Limpieza periódica de la BBDD.
 *
 * Elimina:
 *   - Sesiones expiradas
 *   - Intentos de login con más de N días
 *   - Entradas de audit_log con más de N días
 *
 * Uso:
 *   node --env-file=apps/web/.env.local scripts/cleanup-db.mjs
 *
 * Parámetros (variables de entorno opcionales):
 *   LOGIN_ATTEMPTS_DAYS   días que se guardan los intentos de login  (default: 30)
 *   AUDIT_LOG_DAYS        días que se guarda el audit log            (default: 90)
 *
 * Recomendación: ejecutar como cron diario, p.ej. en el host:
 *   0 3 * * * docker exec pradomotica-app-1 \
 *     node --env-file=/app/.env.local /app/scripts/cleanup-db.mjs
 *
 * O añadir al docker-compose como servicio con restart:no y command cron.
 */

import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('ERROR: DATABASE_URL no definida.');
  process.exit(1);
}

const LOGIN_ATTEMPTS_DAYS = parseInt(process.env.LOGIN_ATTEMPTS_DAYS ?? '30', 10);
const AUDIT_LOG_DAYS      = parseInt(process.env.AUDIT_LOG_DAYS      ?? '90', 10);

const sql = postgres(url, { max: 1 });

async function run() {
  console.log(`[cleanup-db] Iniciando limpieza (${new Date().toISOString()})`);

  // 1. Sesiones expiradas
  const { count: sessions } = await sql`
    WITH deleted AS (
      DELETE FROM sessions
      WHERE expires_at < NOW()
      RETURNING id
    )
    SELECT count(*) AS count FROM deleted
  `;
  console.log(`[cleanup-db] Sesiones expiradas eliminadas: ${sessions}`);

  // 2. Intentos de login antiguos
  const { count: attempts } = await sql`
    WITH deleted AS (
      DELETE FROM login_attempts
      WHERE created_at < NOW() - (${LOGIN_ATTEMPTS_DAYS} || ' days')::interval
      RETURNING id
    )
    SELECT count(*) AS count FROM deleted
  `;
  console.log(`[cleanup-db] login_attempts eliminados (>${LOGIN_ATTEMPTS_DAYS}d): ${attempts}`);

  // 3. Audit log antiguo
  const { count: audit } = await sql`
    WITH deleted AS (
      DELETE FROM audit_log
      WHERE created_at < NOW() - (${AUDIT_LOG_DAYS} || ' days')::interval
      RETURNING id
    )
    SELECT count(*) AS count FROM deleted
  `;
  console.log(`[cleanup-db] audit_log eliminados (>${AUDIT_LOG_DAYS}d): ${audit}`);

  // 4. Invitaciones caducadas (limpieza de cortesía)
  const { count: invites } = await sql`
    WITH deleted AS (
      DELETE FROM household_invites
      WHERE expires_at < NOW()
        AND accepted_at IS NULL
      RETURNING id
    )
    SELECT count(*) AS count FROM deleted
  `;
  console.log(`[cleanup-db] Invitaciones caducadas eliminadas: ${invites}`);

  await sql.end();
  console.log('[cleanup-db] Limpieza completada.');
}

run().catch((err) => {
  console.error('[cleanup-db] Error:', err);
  process.exit(1);
});
