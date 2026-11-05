# @pradomotica/mcp

Servidor MCP **local y de solo lectura** para consultar Avyra desde Claude Code. Corre en el PC por stdio; nunca se despliega al Pi ni se expone por Cloudflare/Tailscale.

## Herramientas

| Herramienta | Qué hace |
| --- | --- |
| `camera_diag_log` | Resumen y filas recientes de `camera_diag_log` (horas, nivel, cámara, límite). Sin `user_id`. |
| `deploy_status` | Versión desplegada vs `origin/master` y veredicto: `up_to_date`, `behind`, `image_pulled_not_running`, `restarting`, `unknown`. |
| `container_status` | Contenedores Docker, memoria, disco y procesos del Pi, con avisos. |

## Registro

`.mcp.json` en la raíz ya lo declara (`node packages/mcp/src/index.ts`, requiere Node 24 por el type stripping). En Claude Code, `/mcp` debe mostrar `avyra`.

Variables opcionales: `AVYRA_SSH_HOST` (por defecto `avyra`) y `AVYRA_SSH_HOSTKEYALIAS` (fallback por IP: `AVYRA_SSH_HOST=youruser@192.168.1.x`, `AVYRA_SSH_HOSTKEYALIAS=pi.local`).

## Modelo de seguridad

- **Sin secretos en el PC.** Todo pasa por SSH con comandos remotos fijos; ningún input se interpola en el shell.
- **SQL por stdin** a `psql` dentro del contenedor; el nombre de la BD se expande allí.
- **Rol `avyra_mcp`** (`infra/sql/mcp-readonly-role.sql`): `SELECT` solo en `camera_diag_log`, `devices(id, name, type, enabled)` y `cameras(device_id)`; `default_transaction_read_only = on`, `statement_timeout = 5s`.
- **Parámetros validados con zod** antes de insertarse como literal SQL.
- **`redact()`** sobre toda salida: tokens GitHub, JWT, Bearer, credenciales en URL (`rtsp://u:p@`), `KEY=valor` sensibles, claves privadas y cadenas hex/base64 largas.
- **stdout limpio:** `console.log/info/debug` van a stderr; el paquete solo importa *tipos* de `@pradomotica/db` (su cliente escribe logs en stdout).
- `docker ps` sin `{{json .}}` (incluye `Command`; cloudflared lleva su token en los argumentos) y `ps` solo con `comm`.

## Aplicar el rol

```sh
ssh avyra "docker exec -i pradomotica-postgres-1 sh -c 'psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v ON_ERROR_STOP=1'" < infra/sql/mcp-readonly-role.sql
```

## Desarrollo

```sh
pnpm --filter @pradomotica/mcp typecheck
pnpm --filter @pradomotica/mcp test
npx @modelcontextprotocol/inspector node packages/mcp/src/index.ts
```

Los tests no tocan SSH: los runners se inyectan.
