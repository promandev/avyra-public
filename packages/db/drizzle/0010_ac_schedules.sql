CREATE TABLE IF NOT EXISTS "ac_schedules" (
  "id" text PRIMARY KEY NOT NULL,
  "device_id" text NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
  "days_of_week" integer[] NOT NULL,
  "start_time" text NOT NULL,
  "temperature" real,
  "hvac_mode" text NOT NULL DEFAULT 'cool',
  "fan_mode" text,
  "ha_automation_id" text,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
