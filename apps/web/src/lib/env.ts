import { z } from 'zod';

/**
 * Validación estricta de variables de entorno en arranque del servidor.
 * Se carga con un import desde `app/layout.tsx` para fallar pronto.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z
    .string()
    .min(1)
    .refine((v) => Buffer.from(v, 'base64').length === 32, {
      message: 'ENCRYPTION_KEY must be 32 bytes encoded in base64',
    }),
  APP_URL: z.string().url(),
  HA_BASE_URL: z.string().url().optional(),
  HA_TOKEN: z.string().optional(),
  HA_WEBHOOK_SECRET: z.string().min(16).optional(),
  CAMERA_WEBHOOK_SECRET: z.string().min(16).optional(),
  GO2RTC_URL: z.string().url().default('http://localhost:1984'),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  WEBAUTHN_RP_ID: z.string().min(1),
  WEBAUTHN_RP_NAME: z.string().min(1),
  WEBAUTHN_ORIGIN: z.string().url(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  TABLET_ACCESS_USER: z.string().optional(),
  TABLET_ACCESS_PASSWORD: z.string().optional(),
  // Minero de drops de Twitch. Sin esta var la sección de streaming se muestra
  // como "no configurada" en vez de fallar.
  TWITCH_MINER_URL: z.string().url().optional(),
  // Impresora: el CUPS interno y la URI IPP directa de la impresora (de ahí se
  // leen su estado y la tinta). Sin ellas la sección sale "no configurada".
  CUPS_URL: z.string().url().optional(),
  PRINTER_URI: z.string().optional(),
  // Carpeta del host montada en el contenedor para la sección Sistema
  // (explorador de archivos y datos del exportador de SSH). Sin ella la
  // sección sólo enseña las métricas.
  PANEL_FILE_ROOT: z.string().optional(),
});

// Durante el build de Docker (SKIP_ENV_VALIDATION=1) no hay vars disponibles.
const parsed = process.env.SKIP_ENV_VALIDATION
  ? ({ success: true as const, data: process.env as unknown as z.infer<typeof schema> })
  : schema.safeParse(process.env);

if (!parsed.success) {
  if (process.env.NODE_ENV !== 'production') {
    console.error('❌ Invalid environment variables:', (parsed as { success: false; error: z.ZodError }).error.flatten().fieldErrors);
  }
  throw new Error('Invalid environment variables. See .env.example.');
}

export const env = parsed.data;
export type Env = typeof env;
