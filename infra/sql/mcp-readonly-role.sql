-- Rol de solo lectura para el servidor MCP local (packages/mcp). Idempotente.
-- Sin contraseña: solo se conecta por el socket Unix dentro del contenedor de Postgres.
-- Aplicar como superusuario:
--   ssh avyra "docker exec -i pradomotica-postgres-1 sh -c 'psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v ON_ERROR_STOP=1'" < infra/sql/mcp-readonly-role.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'avyra_mcp') THEN
    CREATE ROLE avyra_mcp LOGIN;
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO avyra_mcp', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO avyra_mcp;

-- Solo lo que necesitan las herramientas. Nunca config_enc ni tablas con datos personales.
GRANT SELECT ON camera_diag_log TO avyra_mcp;
GRANT SELECT (id, name, type, enabled) ON devices TO avyra_mcp;
GRANT SELECT (device_id) ON cameras TO avyra_mcp;

ALTER ROLE avyra_mcp SET default_transaction_read_only = on;
ALTER ROLE avyra_mcp SET statement_timeout = '5s';
