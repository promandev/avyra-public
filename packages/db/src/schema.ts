/**
 * Pradomotica — Postgres schema (Drizzle ORM).
 *
 * Convenciones:
 * - PKs UUID v7 (generadas en aplicación; columna `id text` para evitar
 *   acoplarnos a una extensión específica).
 * - Campos sensibles en columnas `*_enc` cifrados con AES-256-GCM en la app.
 * - Timestamps en UTC con `withTimezone: true`.
 */

import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ---------- Enums --------------------------------------------------------

export const householdRoleEnum = pgEnum('household_role', ['owner', 'admin', 'viewer']);
export type HouseholdRole = (typeof householdRoleEnum.enumValues)[number];
export const deviceTypeEnum = pgEnum('device_type', [
  'camera',
  'light',
  'thermostat',
  'ac',
  'vacuum',
  'litter_box',
]);

// ---------- Auth ---------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    passwordHash: text('password_hash'),
    totpSecretEnc: text('totp_secret_enc'),
    totpEnabled: boolean('totp_enabled').notNull().default(false),
    isAdmin: boolean('is_admin').notNull().default(false),
    pushEnabled: boolean('push_enabled').notNull().default(true),
    /**
     * Aviso por categoría. El interruptor de arriba manda sobre todos: si está
     * apagado no sale nada, y estos sólo afinan qué llega cuando está encendido.
     */
    pushCameras: boolean('push_cameras').notNull().default(true),
    pushLights: boolean('push_lights').notNull().default(true),
    pushVacuum: boolean('push_vacuum').notNull().default(true),
    pushHeating: boolean('push_heating').notNull().default(true),
    pushAc: boolean('push_ac').notNull().default(true),
    pushPrinter: boolean('push_printer').notNull().default(true),
    pushLitter: boolean('push_litter').notNull().default(true),
    displayName: text('display_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_uniq').on(t.email)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const passkeys = pgTable(
  'passkeys',
  {
    credentialId: text('credential_id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    publicKey: text('public_key').notNull(),
    counter: bigint('counter', { mode: 'number' }).notNull().default(0),
    transports: jsonb('transports').$type<string[]>().notNull().default([]),
    deviceType: text('device_type'),
    backedUp: boolean('backed_up').notNull().default(false),
    nickname: text('nickname'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [index('passkeys_user_idx').on(t.userId)],
);

export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(), // email or ip
    success: boolean('success').notNull(),
    ipHash: text('ip_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('login_attempts_identifier_idx').on(t.identifier, t.createdAt)],
);

export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
    index('oauth_accounts_user_idx').on(t.userId),
  ],
);

// ---------- Households / membership -------------------------------------

export const households = pgTable('households', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  address: text('address'),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const householdMembers = pgTable(
  'household_members',
  {
    householdId: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: householdRoleEnum('role').notNull(),
    invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.userId] }),
    index('household_members_user_idx').on(t.userId),
  ],
);

export const householdInvites = pgTable(
  'household_invites',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: householdRoleEnum('role').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  },
  (t) => [index('household_invites_household_idx').on(t.householdId)],
);

// ---------- Devices ------------------------------------------------------

export const devices = pgTable(
  'devices',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    type: deviceTypeEnum('type').notNull(),
    name: text('name').notNull(),
    haEntityId: text('ha_entity_id'),
    configEnc: text('config_enc'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('devices_household_idx').on(t.householdId, t.type)],
);

export const cameras = pgTable('cameras', {
  deviceId: text('device_id')
    .primaryKey()
    .references(() => devices.id, { onDelete: 'cascade' }),
  model: text('model'),
  mac: text('mac'),
  rtspUrlEnc: text('rtsp_url_enc'),
  snapshotUrlEnc: text('snapshot_url_enc'),
  sdHttpUrlEnc: text('sd_http_url_enc'),
  go2rtcStreamId: text('go2rtc_stream_id'),
});

/**
 * Agente Android para cámaras tablet.
 * Almacena el estado de emparejamiento y los comandos pendientes que
 * el agente Android recoge via polling (/api/cameras/[id]/agent-poll).
 */
export const tabletAgents = pgTable('tablet_agents', {
  deviceId: text('device_id')
    .primaryKey()
    .references(() => devices.id, { onDelete: 'cascade' }),
  /** Secret de emparejamiento cifrado AES (null tras el primer pair). */
  pairingSecretEnc: text('pairing_secret_enc'),
  /** SHA-256 del token de agente emitido tras el pair. Null = no emparejado. */
  tokenHash: text('token_hash'),
  /** 'unpaired' | 'idle' | 'streaming' */
  status: text('status').notNull().default('unpaired'),
  /** Comando pendiente que el agente Android debe ejecutar. */
  pendingCommand: text('pending_command'),
  pairedAt: timestamp('paired_at', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
});

// ---------- Lights -------------------------------------------------------

export const lights = pgTable('lights', {
  deviceId: text('device_id')
    .primaryKey()
    .references(() => devices.id, { onDelete: 'cascade' }),
  model: text('model'),
});

// ---------- Thermostats --------------------------------------------------

export const thermostats = pgTable('thermostats', {
  deviceId: text('device_id')
    .primaryKey()
    .references(() => devices.id, { onDelete: 'cascade' }),
  model: text('model'),
  temperatureScale: real('temperature_scale').notNull().default(1),
});

export const thermostatSchedules = pgTable('thermostat_schedules', {
  id: text('id').primaryKey(),
  deviceId: text('device_id')
    .notNull()
    .references(() => devices.id, { onDelete: 'cascade' }),
  daysOfWeek: integer('days_of_week').array().notNull(),
  startTime: text('start_time').notNull(),
  temperature: real('temperature'),
  hvacMode: text('hvac_mode').notNull().default('heat'),
  haAutomationId: text('ha_automation_id'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- AC units -----------------------------------------------------

export const acUnits = pgTable('ac_units', {
  deviceId: text('device_id')
    .primaryKey()
    .references(() => devices.id, { onDelete: 'cascade' }),
  model: text('model'),
});

export const acSchedules = pgTable('ac_schedules', {
  id: text('id').primaryKey(),
  deviceId: text('device_id')
    .notNull()
    .references(() => devices.id, { onDelete: 'cascade' }),
  daysOfWeek: integer('days_of_week').array().notNull(),
  startTime: text('start_time').notNull(),
  temperature: real('temperature'),
  hvacMode: text('hvac_mode').notNull().default('cool'),
  fanMode: text('fan_mode'),
  haAutomationId: text('ha_automation_id'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Robot vacuums ------------------------------------------------

export const vacuums = pgTable('vacuums', {
  deviceId: text('device_id')
    .primaryKey()
    .references(() => devices.id, { onDelete: 'cascade' }),
  model: text('model'),
  /** Opcional: binary_sensor de fregona/depósito, o select/number de nivel de agua. */
  waterTankEntityId: text('water_tank_entity_id'),
  /** Opcional: tuya-local publica la batería como sensor aparte, no como atributo. */
  batteryEntityId: text('battery_entity_id'),
  /** Opcional: minutos de limpieza que cuenta el propio robot. */
  cleanTimeEntityId: text('clean_time_entity_id'),
  /** Opcional: superficie limpiada que informa el robot. */
  cleanAreaEntityId: text('clean_area_entity_id'),
});

export const vacuumSchedules = pgTable('vacuum_schedules', {
  id: text('id').primaryKey(),
  deviceId: text('device_id')
    .notNull()
    .references(() => devices.id, { onDelete: 'cascade' }),
  daysOfWeek: integer('days_of_week').array().notNull(),
  startTime: text('start_time').notNull(),
  /** Hora de vuelta a la base. Null = el robot termina el ciclo por su cuenta. */
  endTime: text('end_time'),
  /** 'auto' | 'eco' */
  cleanMode: text('clean_mode').notNull().default('auto'),
  haAutomationId: text('ha_automation_id'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Registro de limpiezas. Lo escribe el sondeo de `lib/vacuum-sessions.ts`:
 * una fila por limpieza, abierta (`ended_at` nulo) mientras el robot trabaja.
 */
export const vacuumSessions = pgTable(
  'vacuum_sessions',
  {
    id: text('id').primaryKey(),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    /** Última vez que se le vio trabajando: es el final real al cerrar. */
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    batteryStart: integer('battery_start'),
    batteryEnd: integer('battery_end'),
    cleanMinutes: integer('clean_minutes'),
    /** Superficie al empezar, para saber si el valor cambió de verdad. */
    areaStart: real('area_start'),
    cleanArea: real('clean_area'),
    /** Estado con el que terminó: docked, idle, error… */
    endState: text('end_state'),
  },
  (t) => [index('vacuum_sessions_device_idx').on(t.deviceId, t.startedAt)],
);

// ---------- Arenero ------------------------------------------------------

/** Lo que se recuerda entre pasadas para avisar de un fallo una sola vez. */
export interface LitterAlertState {
  /** Fallos activos ya avisados: id de entidad, `status:<valor>` u `offline`. */
  active: string[];
}

/*
 * Arenero automático. Igual que el robot, se guarda qué entidad de HA hace
 * cada papel y no la integración: el mismo arenero puede llegar por la Tuya
 * oficial o por tuya-local con nombres distintos. `devices.ha_entity_id` es la
 * entidad de estado.
 */
export const litterBoxes = pgTable('litter_boxes', {
  deviceId: text('device_id')
    .primaryKey()
    .references(() => devices.id, { onDelete: 'cascade' }),
  model: text('model'),
  /** Botón, interruptor o script de cada acción. */
  cleanEntityId: text('clean_entity_id'),
  emptyEntityId: text('empty_entity_id'),
  resetEntityId: text('reset_entity_id'),
  /** Interruptor de la limpieza automática tras cada visita. */
  autoCleanEntityId: text('auto_clean_entity_id'),
  /** number: cuánto espera a limpiar después de que salga el gato. */
  cleanDelayEntityId: text('clean_delay_entity_id'),
  /** Peso del gato que publica el arenero tras cada visita. */
  weightEntityId: text('weight_entity_id'),
  /** Contador de visitas del día: cada subida es una visita. */
  visitsEntityId: text('visits_entity_id'),
  durationEntityId: text('duration_entity_id'),
  /** 'daily_total' (segundos acumulados del día) | 'per_visit' (la última visita). */
  durationMode: text('duration_mode').notNull().default('daily_total'),
  /** binary_sensor de fallo: `on` es un problema (bolsa llena, cajón fuera…). */
  faultEntityIds: text('fault_entity_ids').array().notNull().default([]),
  /** Desde cuántos segundos dentro se cuenta como caca (estimación). */
  poopMinSeconds: integer('poop_min_seconds').notNull().default(90),
  /** Hasta dónde se ha leído ya el historial de HA. */
  historyCursor: timestamp('history_cursor', { withTimezone: true }),
  /** Día (Madrid) en que ya salió el resumen de la víspera. */
  lastSummaryDate: date('last_summary_date', { mode: 'string' }),
  alertState: jsonb('alert_state').$type<LitterAlertState>(),
});

/** Gatos del hogar, con el peso que sirve para saber quién ha ido. */
export const litterCats = pgTable(
  'litter_cats',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    referenceWeightKg: real('reference_weight_kg').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('litter_cats_household_idx').on(t.householdId)],
);

/**
 * Una fila por visita al arenero. La escribe `lib/litter-visits.ts` a partir
 * del historial de HA; gato y tipo se calculan y se pueden corregir a mano.
 */
export const litterVisits = pgTable(
  'litter_visits',
  {
    id: text('id').primaryKey(),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    weightKg: real('weight_kg'),
    durationS: integer('duration_s'),
    catId: text('cat_id').references(() => litterCats.id, { onDelete: 'set null' }),
    catManual: boolean('cat_manual').notNull().default(false),
    /** 'pee' | 'poop' | 'unknown' */
    kind: text('kind').notNull().default('unknown'),
    kindManual: boolean('kind_manual').notNull().default(false),
  },
  // Único: el historial se relee con solape y la misma visita no debe entrar dos veces.
  (t) => [uniqueIndex('litter_visits_device_time_uniq').on(t.deviceId, t.occurredAt)],
);

// ---------- Push & audit -------------------------------------------------

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('push_subscriptions_endpoint_uniq').on(t.endpoint),
    index('push_subscriptions_user_idx').on(t.userId),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    target: text('target'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_user_idx').on(t.userId, t.createdAt),
    index('audit_log_action_idx').on(t.action, t.createdAt),
  ],
);

// ---------- Camera motion events -----------------------------------------

export const cameraMotionEvents = pgTable(
  'camera_motion_events',
  {
    id: text('id').primaryKey(),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    /** 'motion' | 'sound' */
    type: text('type').notNull().default('motion'),
    clipUrl: text('clip_url').notNull().default(''),
  },
  (t) => [
    index('camera_motion_events_device_idx').on(t.deviceId, t.occurredAt),
  ],
);

/**
 * Registro interno de fallos de cámara (directo, snapshot y grabaciones), sólo
 * visible para el super admin. Lo escriben tanto las rutas del servidor como el
 * navegador: un 524 de Cloudflare o una sesión HLS caducada sólo los ve el
 * cliente, nunca llegan a la app. Se purga solo pasados unos días.
 */
export const cameraDiagLog = pgTable(
  'camera_diag_log',
  {
    id: text('id').primaryKey(),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    /** 'server' | 'client' */
    source: text('source').notNull(),
    /** 'error' | 'warn' | 'info' */
    level: text('level').notNull(),
    /** Fase: webrtc, hls-master, hls-seg, player, snapshot, recordings… */
    stage: text('stage').notNull(),
    httpStatus: integer('http_status'),
    message: text('message').notNull(),
    /** 'lan' | 'external' (vía túnel de Cloudflare) | null si no se sabe. */
    network: text('network'),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    detail: jsonb('detail').$type<Record<string, unknown>>(),
  },
  (t) => [
    index('camera_diag_log_device_idx').on(t.deviceId, t.occurredAt),
    index('camera_diag_log_time_idx').on(t.occurredAt),
  ],
);

// ---------- Streaming (minero de drops de Twitch) -------------------------

/**
 * Fila única (`id = 'default'`) con todo el estado del minero que Avyra
 * gobierna: qué restaurar al encender y en qué punto va la automatización.
 *
 * El minero persiste `games_to_watch` en su propio disco, pero apagar consiste
 * precisamente en vaciarlo a `[]` para que deje de acumular minutos, así que
 * ese valor se perdería si no lo guardásemos aquí antes.
 *
 * Los tramos de entrada y salida se sortean UNA vez por emisión y se guardan.
 * Sortearlos en cada comprobación daría una distribución rarísima y, peor,
 * un reinicio del contenedor cambiaría la hora elegida a mitad de emisión.
 *
 * El visor propio («Viendo ahora») es independiente del minero de drops: ve al
 * canal seguido mandando minutos vistos, juegue a lo que juegue.
 */
export const streamingMinerSnapshot = pgTable('streaming_miner_snapshot', {
  id: text('id').primaryKey(),

  // ── Qué vigilar ──────────────────────────────────────────────────────────
  targetGames: jsonb('target_games').$type<string[]>().notNull().default([]),
  preferredChannelId: integer('preferred_channel_id'),
  preferredChannelName: text('preferred_channel_name'),

  // ── Automatización ───────────────────────────────────────────────────────
  /** Si está armada, cada tick puede encender o apagar por su cuenta. */
  autoEnabled: boolean('auto_enabled').notNull().default(false),
  /** `stream.id` de Twitch: cambia con cada emisión, así que identifica sesión. */
  sessionKey: text('session_key'),
  /** Inicio de la emisión en curso, según Twitch. */
  sessionStartedAt: timestamp('session_started_at', { withTimezone: true }),
  /** Minutos de emisión tras los cuales entramos. Sorteado en 60-120. */
  joinAfterMin: integer('join_after_min'),
  /** Minutos de emisión tras los cuales salimos. Sorteado en 240-300. */
  leaveAfterMin: integer('leave_after_min'),
  /** Cuándo entramos de verdad en esta sesión. */
  joinedAt: timestamp('joined_at', { withTimezone: true }),
  /** Puesto al salir: impide volver a entrar en la misma emisión. */
  finishedAt: timestamp('finished_at', { withTimezone: true }),

  // ── Visor propio del canal seguido ───────────────────────────────────────
  /** «Viendo ahora»: se manda un minuto visto al canal seguido cada minuto. */
  viewerOn: boolean('viewer_on').notNull().default(false),
  /** Identificador de dispositivo propio y estable, como el de un navegador. */
  viewerDeviceId: text('viewer_device_id'),
  /** Último identificador de usuario de Twitch conocido, por si el minero cae. */
  viewerUserId: text('viewer_user_id'),
  /** Emisión a la que se refieren los minutos contados. */
  viewerSessionKey: text('viewer_session_key'),
  viewerMinutes: integer('viewer_minutes').notNull().default(0),
  viewerLastAt: timestamp('viewer_last_at', { withTimezone: true }),
  viewerLastNote: text('viewer_last_note'),

  // ── Diagnóstico para la interfaz ─────────────────────────────────────────
  lastTickAt: timestamp('last_tick_at', { withTimezone: true }),
  lastTickNote: text('last_tick_note'),

  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Lista de la compra ------------------------------------------

/**
 * Preferencias de la sección Compra por hogar. Las listas viven en Alexa (vía
 * Home Assistant); aquí sólo se guarda en qué orden se muestran.
 */
export const shoppingListPrefs = pgTable('shopping_list_prefs', {
  householdId: text('household_id')
    .primaryKey()
    .references(() => households.id, { onDelete: 'cascade' }),
  /** Entidades `todo.*` en el orden elegido; la primera se abre por defecto. */
  listOrder: jsonb('list_order').$type<string[]>().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Avisos por dispositivo ---------------------------------------

/*
 * Interruptor de avisos push de cada aparato, por usuario: a uno le puede
 * interesar la luz del salón y a otro no. Sin fila manda el valor por defecto
 * de la categoría (las luces vienen apagadas, el resto encendido), así que un
 * aparato nuevo no necesita que nadie le cree nada.
 */
export const devicePushPrefs = pgTable(
  'device_push_prefs',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.deviceId] })],
);

// ---------- Finanzas -----------------------------------------------------

/*
 * Sección Finanzas, sólo super admin. Todo cuelga del usuario (no del hogar):
 * son cuentas personales y la sección no se comparte con los miembros.
 *
 * Importes en céntimos (bigint) para no arrastrar errores de coma flotante.
 * Las fechas de calendario van en `date` (sin hora): el banco no da la hora y
 * una fecha con zona horaria movería movimientos de día al cruzar medianoche.
 */

/**
 * Una deuda: hipoteca, préstamo, deuda familiar… El saldo es una foto a
 * `balance_as_of`; lo pendiente hoy se proyecta a partir de ella con la cuota
 * y el interés, sin tener que actualizarlo a mano cada mes.
 */
export const financeDebts = pgTable(
  'finance_debts',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    lender: text('lender'),
    /** 'mortgage' | 'loan' | 'family' | 'other' */
    kind: text('kind').notNull().default('loan'),
    /** Capital pendiente a `balance_as_of`. Null si no se sabe. */
    balanceCents: bigint('balance_cents', { mode: 'number' }),
    balanceAsOf: date('balance_as_of', { mode: 'string' }).notNull(),
    /** Parte de la cuota que amortiza esta deuda. */
    monthlyPaymentCents: bigint('monthly_payment_cents', { mode: 'number' }).notNull(),
    paymentDay: integer('payment_day'),
    /** TIN anual en %. Null: se deduce de la fecha de fin, o 0 si no hay. */
    annualRate: real('annual_rate'),
    endDate: date('end_date', { mode: 'string' }),
    /** Fin del tramo fijo de una hipoteca mixta: desde ahí el tipo es variable. */
    rateReviewDate: date('rate_review_date', { mode: 'string' }),
    /** Texto que aparece en el movimiento del banco que paga la cuota. */
    matchText: text('match_text'),
    /** Importe del cargo en el banco si no coincide con la cuota (p. ej. 345 € por 300 €). */
    matchAmountCents: bigint('match_amount_cents', { mode: 'number' }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('finance_debts_owner_idx').on(t.ownerUserId)],
);

/** Pago o ingreso fijo que no es una deuda: luz, seguros, suscripciones, nómina. */
export const financeRecurring = pgTable(
  'finance_recurring',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Con signo: negativo es gasto, positivo ingreso. Si varía, el habitual. */
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    dayOfMonth: integer('day_of_month'),
    matchText: text('match_text'),
    /** Si está puesto, el movimiento tiene que ser exactamente de este importe. */
    matchAmountCents: bigint('match_amount_cents', { mode: 'number' }),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('finance_recurring_owner_idx').on(t.ownerUserId)],
);

/** Cada subida de un Excel del banco, para poder deshacerla. */
export const financeImports = pgTable(
  'finance_imports',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Últimos 4 dígitos de la cuenta; el número completo no se guarda. */
    account: text('account').notNull(),
    rowsTotal: integer('rows_total').notNull(),
    rowsNew: integer('rows_new').notNull(),
    rowsUpdated: integer('rows_updated').notNull(),
    dateFrom: date('date_from', { mode: 'string' }),
    dateTo: date('date_to', { mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('finance_imports_owner_idx').on(t.ownerUserId, t.createdAt)],
);

/**
 * Movimiento bancario importado. La descripción y el comentario van cifrados
 * (nombres de personas en los Bizum, comercios…): un volcado de la BD deja ver
 * importes y fechas, pero no a quién ni dónde.
 *
 * `dedupe_key` identifica el movimiento entre exportaciones solapadas: hash de
 * cuenta + fecha + importe + saldo resultante. El saldo hace la posición única
 * en la cadena, y no entra la descripción porque ING la retoca al liquidar.
 */
export const financeTransactions = pgTable(
  'finance_transactions',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    account: text('account').notNull(),
    valueDate: date('value_date', { mode: 'string' }).notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    balanceCents: bigint('balance_cents', { mode: 'number' }),
    category: text('category'),
    subcategory: text('subcategory'),
    descriptionEnc: text('description_enc').notNull(),
    commentEnc: text('comment_enc'),
    dedupeKey: text('dedupe_key').notNull(),
    importId: text('import_id').references(() => financeImports.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('finance_transactions_dedupe_uniq').on(t.ownerUserId, t.dedupeKey),
    index('finance_transactions_owner_date_idx').on(t.ownerUserId, t.valueDate),
    index('finance_transactions_import_idx').on(t.importId),
  ],
);

// ---------- Type helpers -------------------------------------------------

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Household = typeof households.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type Camera = typeof cameras.$inferSelect;
export type Light = typeof lights.$inferSelect;
export type Thermostat = typeof thermostats.$inferSelect;
export type AcUnit = typeof acUnits.$inferSelect;
export type Vacuum = typeof vacuums.$inferSelect;
export type LitterBox = typeof litterBoxes.$inferSelect;
export type Passkey = typeof passkeys.$inferSelect;
