/**
 * Next.js instrumentation hook — runs once on server startup (Node.js runtime only).
 * Applies any pending Drizzle migrations so production never needs a manual step.
 *
 * Uses `postgres` and `drizzle-orm` directly (not @pradomotica/db) so that the
 * dynamic imports resolve from node_modules in the standalone output.
 * Both packages are listed in `serverExternalPackages` in next.config.ts so that
 * Next.js/nft includes them in the standalone build instead of bundling them.
 *
 * node:fs and node:path are also dynamic (inside the function, after the runtime
 * check) to prevent Next.js from trying to bundle them for the Edge Runtime.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { existsSync } = await import('node:fs');
  const { default: path } = await import('node:path');

  const candidate1 = path.join(process.cwd(), 'packages/db/drizzle');
  const candidate2 = path.join(process.cwd(), '../../packages/db/drizzle');
  const migrationsFolder = existsSync(candidate1) ? candidate1 : candidate2;

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[db] DATABASE_URL not set — skipping migrations');
    return;
  }

  try {
    const { default: postgres } = await import('postgres');
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');

    const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });
    const db = drizzle(sql);

    console.log(`[db] Running migrations from: ${migrationsFolder}`);
    await migrate(db, { migrationsFolder });
    console.log('[db] Migrations applied successfully');

    await sql.end();
  } catch (err: unknown) {
    // If Drizzle migrator fails (e.g. hash mismatch on modified files), ensure
    // critical schema exists via raw SQL so the app can still function.
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[db] Migration error:', msg);

    try {
      const { default: postgres } = await import('postgres');
      const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

      console.log('[db] Applying schema fallback (ensure tables/columns exist)...');
      await sql.unsafe(`
        ALTER TABLE "thermostats" ADD COLUMN IF NOT EXISTS "temperature_scale" real DEFAULT 1 NOT NULL;

        CREATE TABLE IF NOT EXISTS "thermostat_schedules" (
          "id" text PRIMARY KEY NOT NULL,
          "device_id" text NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
          "days_of_week" integer[] NOT NULL DEFAULT '{}',
          "start_time" text NOT NULL,
          "temperature" real,
          "hvac_mode" text NOT NULL DEFAULT 'heat',
          "ha_automation_id" text,
          "enabled" boolean NOT NULL DEFAULT true,
          "created_at" timestamp with time zone NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS "thermostat_schedules_device_idx"
          ON "thermostat_schedules" ("device_id");

        -- Programación de la calefacción (0008 y 0009). La tabla de la Raspberry
        -- se creó con la 0007 y el CREATE de arriba se la salta, así que seguía
        -- con "day_of_week": la sección Programación fallaba entera con
        -- "column days_of_week does not exist". Se pasa al esquema actual aquí.
        ALTER TABLE "thermostat_schedules" ADD COLUMN IF NOT EXISTS "hvac_mode" text NOT NULL DEFAULT 'heat';
        ALTER TABLE "thermostat_schedules" ALTER COLUMN "temperature" DROP NOT NULL;
        ALTER TABLE "thermostat_schedules" ADD COLUMN IF NOT EXISTS "days_of_week" integer[];
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'thermostat_schedules' AND column_name = 'day_of_week'
          ) THEN
            UPDATE "thermostat_schedules" SET "days_of_week" = ARRAY["day_of_week"]
              WHERE "days_of_week" IS NULL;
            ALTER TABLE "thermostat_schedules" DROP COLUMN "day_of_week";
          END IF;
        END $$;
        UPDATE "thermostat_schedules" SET "days_of_week" = '{}' WHERE "days_of_week" IS NULL;
        ALTER TABLE "thermostat_schedules" ALTER COLUMN "days_of_week" SET NOT NULL;

        ALTER TABLE "camera_motion_events" ADD COLUMN IF NOT EXISTS "clip_url" text NOT NULL DEFAULT '';

        -- Crítica: push_enabled está en el esquema de Drizzle, así que TODA
        -- consulta a la tabla users la pide, incluida la de inicio de sesión.
        -- Si la migración 0012 no llega a aplicarse, no falla sólo el push:
        -- cae la aplicación entera con "column push_enabled does not exist".
        ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "push_enabled" boolean NOT NULL DEFAULT true;

        CREATE TABLE IF NOT EXISTS "streaming_miner_snapshot" (
          "id" text PRIMARY KEY NOT NULL,
          "target_games" jsonb NOT NULL DEFAULT '[]'::jsonb,
          "preferred_channel_id" integer,
          "preferred_channel_name" text,
          "auto_enabled" boolean NOT NULL DEFAULT false,
          "session_key" text,
          "session_started_at" timestamp with time zone,
          "join_after_min" integer,
          "leave_after_min" integer,
          "joined_at" timestamp with time zone,
          "finished_at" timestamp with time zone,
          "last_tick_at" timestamp with time zone,
          "last_tick_note" text,
          "updated_at" timestamp with time zone NOT NULL DEFAULT now()
        );

        -- Robot aspirador (0013). ADD VALUE puede ir en una transacción desde
        -- Postgres 12 siempre que el valor nuevo no se use en ella.
        ALTER TYPE "device_type" ADD VALUE IF NOT EXISTS 'vacuum';

        CREATE TABLE IF NOT EXISTS "vacuums" (
          "device_id" text PRIMARY KEY NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
          "model" text,
          "water_tank_entity_id" text,
          "battery_entity_id" text
        );

        CREATE TABLE IF NOT EXISTS "vacuum_schedules" (
          "id" text PRIMARY KEY NOT NULL,
          "device_id" text NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
          "days_of_week" integer[] NOT NULL,
          "start_time" text NOT NULL,
          "end_time" text,
          "clean_mode" text NOT NULL DEFAULT 'auto',
          "ha_automation_id" text,
          "enabled" boolean NOT NULL DEFAULT true,
          "created_at" timestamp with time zone NOT NULL DEFAULT now()
        );

        -- Registro de limpiezas (0014). Crítico: la página del aspirador
        -- consulta las dos columnas nuevas de vacuums en cada carga.
        ALTER TABLE "vacuums" ADD COLUMN IF NOT EXISTS "clean_time_entity_id" text;
        ALTER TABLE "vacuums" ADD COLUMN IF NOT EXISTS "clean_area_entity_id" text;

        CREATE TABLE IF NOT EXISTS "vacuum_sessions" (
          "id" text PRIMARY KEY NOT NULL,
          "device_id" text NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
          "started_at" timestamp with time zone NOT NULL,
          "last_active_at" timestamp with time zone NOT NULL,
          "ended_at" timestamp with time zone,
          "battery_start" integer,
          "battery_end" integer,
          "clean_minutes" integer,
          "area_start" real,
          "clean_area" real,
          "end_state" text
        );

        CREATE INDEX IF NOT EXISTS "vacuum_sessions_device_idx"
          ON "vacuum_sessions" ("device_id", "started_at");

        -- Visor propio del canal seguido (0015). Crítico: el panel de Streaming
        -- lee estas columnas en cada carga.
        ALTER TABLE "streaming_miner_snapshot" ADD COLUMN IF NOT EXISTS "viewer_on" boolean NOT NULL DEFAULT false;
        ALTER TABLE "streaming_miner_snapshot" ADD COLUMN IF NOT EXISTS "viewer_device_id" text;
        ALTER TABLE "streaming_miner_snapshot" ADD COLUMN IF NOT EXISTS "viewer_user_id" text;
        ALTER TABLE "streaming_miner_snapshot" ADD COLUMN IF NOT EXISTS "viewer_session_key" text;
        ALTER TABLE "streaming_miner_snapshot" ADD COLUMN IF NOT EXISTS "viewer_minutes" integer NOT NULL DEFAULT 0;
        ALTER TABLE "streaming_miner_snapshot" ADD COLUMN IF NOT EXISTS "viewer_last_at" timestamp with time zone;
        ALTER TABLE "streaming_miner_snapshot" ADD COLUMN IF NOT EXISTS "viewer_last_note" text;

        -- Aviso por categoría (0016). Igual de crítico que push_enabled: están
        -- en el esquema de Drizzle, así que cualquier consulta a users las pide
        -- y sin ellas no se puede ni iniciar sesión.
        ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "push_cameras" boolean NOT NULL DEFAULT true;
        ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "push_lights" boolean NOT NULL DEFAULT true;
        ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "push_vacuum" boolean NOT NULL DEFAULT true;
        ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "push_heating" boolean NOT NULL DEFAULT true;
        ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "push_ac" boolean NOT NULL DEFAULT true;
        ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "push_printer" boolean NOT NULL DEFAULT true;

        -- Registro de fallos de cámara (0017). No crítico: si falta, las
        -- escrituras del log fallan en silencio, pero así el panel funciona.
        CREATE TABLE IF NOT EXISTS "camera_diag_log" (
          "id" text PRIMARY KEY NOT NULL,
          "device_id" text NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
          "occurred_at" timestamp with time zone NOT NULL DEFAULT now(),
          "source" text NOT NULL,
          "level" text NOT NULL,
          "stage" text NOT NULL,
          "http_status" integer,
          "message" text NOT NULL,
          "network" text,
          "user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
          "detail" jsonb
        );
        CREATE INDEX IF NOT EXISTS "camera_diag_log_device_idx"
          ON "camera_diag_log" ("device_id", "occurred_at");
        CREATE INDEX IF NOT EXISTS "camera_diag_log_time_idx"
          ON "camera_diag_log" ("occurred_at");

        -- Orden de las listas de Alexa (0018). No crítico: sólo lo consulta la
        -- sección Compra, que sin la tabla usa el orden por defecto.
        CREATE TABLE IF NOT EXISTS "shopping_list_prefs" (
          "household_id" text PRIMARY KEY NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
          "list_order" jsonb NOT NULL DEFAULT '[]'::jsonb,
          "updated_at" timestamp with time zone NOT NULL DEFAULT now()
        );

        -- Sección Finanzas (0019). No crítico: sólo la consultan sus rutas.
        CREATE TABLE IF NOT EXISTS "finance_debts" (
          "id" text PRIMARY KEY NOT NULL,
          "owner_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
          "name" text NOT NULL,
          "lender" text,
          "kind" text NOT NULL DEFAULT 'loan',
          "balance_cents" bigint,
          "balance_as_of" date NOT NULL,
          "monthly_payment_cents" bigint NOT NULL,
          "payment_day" integer,
          "annual_rate" real,
          "end_date" date,
          "rate_review_date" date,
          "match_text" text,
          "match_amount_cents" bigint,
          "notes" text,
          "created_at" timestamp with time zone NOT NULL DEFAULT now(),
          "updated_at" timestamp with time zone NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS "finance_debts_owner_idx" ON "finance_debts" ("owner_user_id");
        CREATE TABLE IF NOT EXISTS "finance_recurring" (
          "id" text PRIMARY KEY NOT NULL,
          "owner_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
          "name" text NOT NULL,
          "amount_cents" bigint NOT NULL,
          "day_of_month" integer,
          "match_text" text,
          "match_amount_cents" bigint,
          "active" boolean NOT NULL DEFAULT true,
          "created_at" timestamp with time zone NOT NULL DEFAULT now(),
          "updated_at" timestamp with time zone NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS "finance_recurring_owner_idx" ON "finance_recurring" ("owner_user_id");
        CREATE TABLE IF NOT EXISTS "finance_imports" (
          "id" text PRIMARY KEY NOT NULL,
          "owner_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
          "account" text NOT NULL,
          "rows_total" integer NOT NULL,
          "rows_new" integer NOT NULL,
          "rows_updated" integer NOT NULL,
          "date_from" date,
          "date_to" date,
          "created_at" timestamp with time zone NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS "finance_imports_owner_idx" ON "finance_imports" ("owner_user_id", "created_at");
        CREATE TABLE IF NOT EXISTS "finance_transactions" (
          "id" text PRIMARY KEY NOT NULL,
          "owner_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
          "account" text NOT NULL,
          "value_date" date NOT NULL,
          "amount_cents" bigint NOT NULL,
          "balance_cents" bigint,
          "category" text,
          "subcategory" text,
          "description_enc" text NOT NULL,
          "comment_enc" text,
          "dedupe_key" text NOT NULL,
          "import_id" text REFERENCES "finance_imports"("id") ON DELETE SET NULL,
          "created_at" timestamp with time zone NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS "finance_transactions_dedupe_uniq"
          ON "finance_transactions" ("owner_user_id", "dedupe_key");
        CREATE INDEX IF NOT EXISTS "finance_transactions_owner_date_idx"
          ON "finance_transactions" ("owner_user_id", "value_date");
        CREATE INDEX IF NOT EXISTS "finance_transactions_import_idx"
          ON "finance_transactions" ("import_id");

        -- Avisos por dispositivo (0020). No crítico: sin la tabla, el envío
        -- cae al valor por defecto de cada categoría.
        CREATE TABLE IF NOT EXISTS "device_push_prefs" (
          "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
          "device_id" text NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
          "enabled" boolean NOT NULL,
          "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
          PRIMARY KEY ("user_id", "device_id")
        );

        -- Arenero (0021). push_litter es crítico como el resto de push_*: está
        -- en el esquema de users y sin ella no se puede ni iniciar sesión.
        ALTER TYPE "device_type" ADD VALUE IF NOT EXISTS 'litter_box';
        ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "push_litter" boolean NOT NULL DEFAULT true;

        CREATE TABLE IF NOT EXISTS "litter_boxes" (
          "device_id" text PRIMARY KEY NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
          "model" text,
          "clean_entity_id" text,
          "empty_entity_id" text,
          "reset_entity_id" text,
          "auto_clean_entity_id" text,
          "clean_delay_entity_id" text,
          "weight_entity_id" text,
          "visits_entity_id" text,
          "duration_entity_id" text,
          "duration_mode" text NOT NULL DEFAULT 'daily_total',
          "fault_entity_ids" text[] NOT NULL DEFAULT '{}',
          "poop_min_seconds" integer NOT NULL DEFAULT 90,
          "history_cursor" timestamp with time zone,
          "last_summary_date" date,
          "alert_state" jsonb
        );

        CREATE TABLE IF NOT EXISTS "litter_cats" (
          "id" text PRIMARY KEY NOT NULL,
          "household_id" text NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
          "name" text NOT NULL,
          "reference_weight_kg" real NOT NULL,
          "created_at" timestamp with time zone NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS "litter_cats_household_idx" ON "litter_cats" ("household_id");

        CREATE TABLE IF NOT EXISTS "litter_visits" (
          "id" text PRIMARY KEY NOT NULL,
          "device_id" text NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
          "occurred_at" timestamp with time zone NOT NULL,
          "weight_kg" real,
          "duration_s" integer,
          "cat_id" text REFERENCES "litter_cats"("id") ON DELETE SET NULL,
          "cat_manual" boolean NOT NULL DEFAULT false,
          "kind" text NOT NULL DEFAULT 'unknown',
          "kind_manual" boolean NOT NULL DEFAULT false
        );
        CREATE UNIQUE INDEX IF NOT EXISTS "litter_visits_device_time_uniq"
          ON "litter_visits" ("device_id", "occurred_at");
      `);
      console.log('[db] Schema fallback applied');

      await sql.end();
    } catch (fallbackErr) {
      console.error('[db] Schema fallback also failed:', fallbackErr);
    }
  }

  startStreamingAutomation();
  startStreamingViewer();
  startVacuumSessionTracker();
  startLitterTracker();
  startDeviceAlertTracker();
  startPrinterAlertTracker();
}

/**
 * Comprobación periódica del minero de drops.
 *
 * Va dentro del proceso y no en cron del anfitrión a propósito: cron obligaría
 * a exponer una ruta con un secreto compartido, y esa ruta manipula una cuenta
 * de Twitch. Aquí no hay superficie nueva que proteger.
 *
 * El tick es barato cuando no hay nada que hacer: una consulta a Twitch y una
 * fila de Postgres. Si la automatización está desarmada, ni eso.
 */
function startStreamingAutomation() {
  const EVERY_MS = 4 * 60 * 1000;

  // `unref` evita que el temporizador mantenga vivo el proceso al apagarlo.
  const timer = setInterval(() => {
    void (async () => {
      try {
        const { runAutomationTick } = await import('@/lib/streaming-automation');
        const result = await runAutomationTick();
        // Sólo se registran las decisiones, no los "sin novedad", para no
        // llenar los logs de ruido cada cuatro minutos.
        if (result.action === 'started' || result.action === 'stopped') {
          console.log(`[streaming] ${result.action}: ${result.note}`);
        }
      } catch (err) {
        console.error('[streaming] Tick failed:', err instanceof Error ? err.message : err);
      }
    })();
  }, EVERY_MS);

  timer.unref?.();
  console.log('[streaming] Automation scheduler started');
}

/**
 * «Viendo ahora»: un minuto visto al canal seguido cada 59 s, el mismo ritmo
 * que usa el minero de drops. Apagado, cada pasada es una sola lectura de la
 * fila de estado. Las pasadas no se solapan: con Twitch lento, dos a la vez
 * contarían el mismo minuto dos veces.
 */
function startStreamingViewer() {
  const EVERY_MS = 59 * 1000;
  let running = false;

  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void (async () => {
      try {
        const { runViewerTick } = await import('@/lib/streaming-viewer');
        await runViewerTick();
      } catch (err) {
        console.error('[streaming] Viewer tick failed:', err instanceof Error ? err.message : err);
      } finally {
        running = false;
      }
    })();
  }, EVERY_MS);

  timer.unref?.();
  console.log('[streaming] Viewer started');
}

/**
 * Registro de limpiezas del robot aspirador.
 *
 * Cada 30 s se lee el estado de cada robot y se abre o cierra su sesión. Es la
 * precisión con la que quedan anotados el inicio y el fin, y cuesta unas pocas
 * lecturas locales a Home Assistant por robot.
 */
function startVacuumSessionTracker() {
  const EVERY_MS = 30 * 1000;
  let running = false;

  const timer = setInterval(() => {
    // Si una pasada se alarga (HA lento), no se solapa con la siguiente: dos a
    // la vez podrían abrir la misma sesión dos veces.
    if (running) return;
    running = true;
    void (async () => {
      try {
        const { runVacuumSessionTick } = await import('@/lib/vacuum-sessions');
        const result = await runVacuumSessionTick();
        if (result.opened || result.closed) {
          console.log(`[vacuum] sessions opened=${result.opened} closed=${result.closed}`);
        }
      } catch (err) {
        console.error('[vacuum] Session tick failed:', err instanceof Error ? err.message : err);
      } finally {
        running = false;
      }
    })();
  }, EVERY_MS);

  timer.unref?.();
  console.log('[vacuum] Session tracker started');
}

/**
 * Arenero: visitas, avisos de fallo y el resumen diario de las 10:00.
 *
 * Las visitas salen del historial de HA, no de esta lectura, así que el ritmo
 * sólo decide cuánto tardan en aparecer, no si se pierde alguna.
 */
function startLitterTracker() {
  const EVERY_MS = 30 * 1000;
  let running = false;

  const timer = setInterval(() => {
    // Sin solape: dos pasadas a la vez podrían mandar el mismo aviso dos veces.
    if (running) return;
    running = true;
    void (async () => {
      try {
        const { runLitterTick } = await import('@/lib/litter-visits');
        const result = await runLitterTick();
        if (result.recorded) console.log(`[litter] visits recorded=${result.recorded}`);
      } catch (err) {
        console.error('[litter] Tick failed:', err instanceof Error ? err.message : err);
      } finally {
        running = false;
      }
    })();
  }, EVERY_MS);

  timer.unref?.();
  console.log('[litter] Tracker started');
}

/**
 * Avisos de luces y climatización.
 *
 * Home Assistant no empuja nada hacia aquí, así que el único modo de enterarse
 * de que un horario ha encendido la calefacción es mirarlo. Mismo ritmo que el
 * aspirador: medio minuto es suficiente para que el aviso llegue a tiempo y son
 * unas pocas lecturas locales por aparato.
 *
 * Lo que se manda desde la propia app queda silenciado por su server action, así
 * que esto sólo avisa de los cambios que vienen de fuera.
 */
function startDeviceAlertTracker() {
  const EVERY_MS = 30 * 1000;
  let running = false;

  const timer = setInterval(() => {
    // Sin solapes: dos pasadas a la vez compararían con la misma foto vieja y
    // mandarían el aviso dos veces.
    if (running) return;
    running = true;
    void (async () => {
      try {
        const { runDeviceAlertTick } = await import('@/lib/device-alerts');
        const { sent } = await runDeviceAlertTick();
        if (sent > 0) console.log(`[alerts] ${sent} device notification(s) sent`);
      } catch (err) {
        console.error('[alerts] Device tick failed:', err instanceof Error ? err.message : err);
      } finally {
        running = false;
      }
    })();
  }, EVERY_MS);

  timer.unref?.();
  console.log('[alerts] Device alert tracker started');
}

/**
 * Avisos de la impresora.
 *
 * Cada minuto, y sólo al CUPS interno: preguntar a la DeskJet directamente la
 * despertaría a todas horas para nada. Un trabajo tarda más de un minuto en
 * imprimirse, así que este ritmo no pierde ningún final.
 */
function startPrinterAlertTracker() {
  const EVERY_MS = 60 * 1000;
  let running = false;

  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void (async () => {
      try {
        const { runPrinterAlertTick } = await import('@/lib/device-alerts');
        const { sent } = await runPrinterAlertTick();
        if (sent > 0) console.log(`[alerts] ${sent} printer notification(s) sent`);
      } catch (err) {
        // Con la impresora apagada o el CUPS caído esto falla cada minuto: se
        // registra en corto para no llenar el log de trazas.
        console.error('[alerts] Printer tick failed:', err instanceof Error ? err.message : err);
      } finally {
        running = false;
      }
    })();
  }, EVERY_MS);

  timer.unref?.();
  console.log('[alerts] Printer alert tracker started');
}
