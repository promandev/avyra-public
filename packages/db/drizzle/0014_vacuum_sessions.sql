ALTER TABLE "vacuums" ADD COLUMN IF NOT EXISTS "clean_time_entity_id" text;--> statement-breakpoint
ALTER TABLE "vacuums" ADD COLUMN IF NOT EXISTS "clean_area_entity_id" text;--> statement-breakpoint
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
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vacuum_sessions_device_idx" ON "vacuum_sessions" ("device_id", "started_at");
