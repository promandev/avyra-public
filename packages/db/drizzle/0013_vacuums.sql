ALTER TYPE "device_type" ADD VALUE IF NOT EXISTS 'vacuum';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vacuums" (
  "device_id" text PRIMARY KEY NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
  "model" text,
  "water_tank_entity_id" text,
  "battery_entity_id" text
);--> statement-breakpoint
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
