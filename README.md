# Avyra

Panel domótico privado, self-hosted. Gestión de cámaras de seguridad Yi (vía firmware `yi-hack`) con streaming WebRTC, detección de movimiento/sonido/IA, aire acondicionado, luces, calefacción y notificaciones push.

## Stack tecnológico

### Frontend / BFF
| Tecnología | Versión | Uso |
|---|---|---|
| **Next.js** | ^16 (App Router) | Framework fullstack principal |
| **TypeScript** | 5.x | Tipado estático en todo el proyecto |
| **Tailwind CSS** | v4 | Estilos utilitarios |
| **shadcn/ui** | latest | Componentes UI accesibles |
| **Lucide React** | ^0.468 | Iconografía |
| **next-intl** | ^4 | Internacionalización (ES / EN / FR) |
| **next-themes** | ^0.4 | Modo claro/oscuro |
| **TanStack Query** | ^5 | Fetching y caché cliente |
| **React Hook Form** | ^7 | Formularios |
| **HLS.js** | ^1.6 | Reproducción de clips de video |

### Autenticación
| Tecnología | Uso |
|---|---|
| **Auth.js v5** (next-auth beta) | Sesiones, proveedores OAuth |
| **SimpleWebAuthn** | Passkeys (WebAuthn) |
| **otplib** | TOTP / 2FA |
| **argon2id** | Hash de contraseñas |
| **Crypto (AES-256-GCM)** | Cifrado de campos sensibles |

### Base de datos
| Tecnología | Uso |
|---|---|
| **PostgreSQL 16** | Base de datos relacional |
| **Drizzle ORM** | ORM typesafe + migraciones SQL |

### Infraestructura domótica
| Tecnología | Uso |
|---|---|
| **go2rtc** | Servidor WebRTC/RTSP para streams de cámara |
| **Home Assistant** | Integración domótica (HVAC, luces) |
| **Yi-hack firmware** | Firmware alternativo para cámaras Yi |

### Infraestructura de despliegue
| Tecnología | Uso |
|---|---|
| **Docker / Docker Compose** | Contenedorización de todos los servicios |
| **Caddy** | Reverse proxy + TLS automático (Let's Encrypt / interno) |
| **Tailscale** | VPN mesh para acceso remoto seguro |
| **Web Push (VAPID)** | Notificaciones push nativas |

### Herramientas de desarrollo
| Tecnología | Uso |
|---|---|
| **pnpm workspaces** | Monorepo con workspaces |
| **Playwright** | Tests E2E |
| **Prettier** | Formateo de código |

---

## Estructura del repositorio

```
.
├── apps/
│   └── web/                  # Next.js 16 (UI + BFF)
│       ├── src/
│       │   ├── app/          # Rutas App Router
│       │   │   ├── dashboard/   # Panel principal (cámaras, luces, AC, etc.)
│       │   │   ├── login/       # Autenticación
│       │   │   ├── onboarding/  # Setup inicial
│       │   │   └── api/         # Route handlers (webhooks, push, streams)
│       │   ├── components/   # Componentes reutilizables
│       │   ├── lib/          # Utilidades, auth, crypto, versión
│       │   └── i18n/         # Configuración de internacionalización
│       └── messages/         # Traducciones (es, en, fr)
├── packages/
│   └── db/                   # Drizzle ORM: schema, migraciones, cliente
│       └── drizzle/          # Archivos SQL de migración
├── infra/
│   ├── docker-compose.yml        # Desarrollo local
│   ├── docker-compose.vps.yml    # Producción VPS
│   ├── Caddyfile                 # Configuración Caddy
│   ├── go2rtc/               # Config go2rtc (local + VPS)
│   └── recorder/             # Grabador de clips (Dockerfile + script)
├── scripts/                  # Scripts de utilidad (migraciones, seeds, webhooks)
├── e2e/                      # Tests Playwright
└── CHANGELOG.md              # Historial de versiones
```

---

## Quickstart — Desarrollo local

**Requisitos:** Node.js ≥ 22, pnpm ≥ 10, PostgreSQL 16 (o Docker)

```bash
# 1. Clonar e instalar dependencias
git clone https://github.com/youruser/avyra.git
cd avyra
pnpm install

# 2. Variables de entorno
cp infra/.env.example apps/web/.env.local
```

Edita `apps/web/.env.local` y rellena al menos:

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | URL de conexión PostgreSQL |
| `AUTH_SECRET` | Secreto de Auth.js (≥ 32 bytes) |
| `ENCRYPTION_KEY` | Clave AES-256 en base64 (32 bytes) |
| `APP_URL` | URL base de la app (p. ej. `http://localhost:3000`) |
| `WEBAUTHN_RP_ID` | Dominio para WebAuthn (p. ej. `localhost`) |
| `WEBAUTHN_RP_NAME` | Nombre mostrado en el prompt de passkey |
| `WEBAUTHN_ORIGIN` | Origen completo (p. ej. `http://localhost:3000`) |
| `GO2RTC_URL` | URL del servidor go2rtc |
| `VAPID_PUBLIC_KEY` | Clave pública VAPID para notificaciones push |
| `VAPID_PRIVATE_KEY` | Clave privada VAPID |
| `VAPID_SUBJECT` | `mailto:correo@dominio.com` |
| `CAMERA_WEBHOOK_SECRET` | Secreto para validar webhooks de cámaras |

```bash
# 3. Generar claves
openssl rand -base64 48                                               # → AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # → ENCRYPTION_KEY
npx web-push generate-vapid-keys                                      # → VAPID keys

# 4. Ejecutar migraciones de base de datos
pnpm db:generate
pnpm db:migrate

# 5. (Opcional) Crear usuario admin
pnpm db:create-admin

# 6. Iniciar servidor de desarrollo
pnpm dev          # Levanta Next.js + PostgreSQL embebido
# o por separado:
pnpm dev:db       # Solo PostgreSQL embebido
pnpm dev:next     # Solo Next.js (http://localhost:3000)
```

---

## Despliegue en producción (VPS / servidor local)

```bash
# 1. En el servidor, clonar el repositorio
git clone https://github.com/youruser/avyra.git
cd avyra/infra

# 2. Variables de entorno
cp .env.example .env
# Edita .env con los valores de producción

# 3. Levantar todos los servicios
docker compose -f docker-compose.vps.yml up -d

# 4. Aplicar migraciones
docker compose -f docker-compose.vps.yml exec app pnpm db:migrate
```

**Servicios en producción:**
- `app` — Next.js en puerto 3000 (detrás de Caddy)
- `db` — PostgreSQL 16
- `go2rtc` — Servidor de streams (puertos 1984 HTTP, 8554 RTSP, 8555 WebRTC)
- `recorder` — Grabador de clips de cámara
- `caddy` — Reverse proxy HTTPS

Caddy gestiona TLS automáticamente. Configura el DNS o usa Tailscale para el acceso remoto.

---

## Comandos útiles

```bash
# Base de datos
pnpm db:generate        # Generar migraciones desde schema
pnpm db:migrate         # Aplicar migraciones pendientes
pnpm db:studio          # Abrir Drizzle Studio (UI de BD)
pnpm db:seed            # Sembrar usuario de prueba

# Versión
node scripts/bump-version.mjs   # Incrementar versión patch

# Tests
pnpm test               # Unit tests
pnpm test:e2e           # Tests E2E con Playwright

# Build
pnpm build              # Build de producción
pnpm lint               # Lint
pnpm typecheck          # Type checking
```

---

## Control de versiones

El proyecto usa **versionado semántico** (semver) con incremento automático de parche en cada despliegue.
La versión actual se muestra en el footer del menú lateral del dashboard.

Ver [CHANGELOG.md](./CHANGELOG.md) para el historial completo de cambios.

---

## Seguridad

- Cookies de sesión `__Host-` con `HttpOnly`, `Secure`, `SameSite=Strict`.
- CSP por request con nonce dinámico (ver `src/middleware.ts`).
- Cabeceras de seguridad: HSTS, `X-Frame-Options: DENY`, COOP, CORP, `Permissions-Policy`.
- Campos sensibles cifrados AES-256-GCM (clave en `ENCRYPTION_KEY`).
- Audit log en PostgreSQL con IP hasheada (SHA-256).
- Cámaras en VLAN aislada sin egress a internet.
- Webhooks de cámaras validados con HMAC-SHA256.

---

## Licencia

Privado — todos los derechos reservados.
