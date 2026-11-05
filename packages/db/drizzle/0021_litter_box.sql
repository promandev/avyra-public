ALTER TYPE "device_type" ADD VALUE IF NOT EXISTS 'litter_box';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "push_litter" boolean NOT NULL DEFAULT true;--> statement-breakpoint
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
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "litter_cats" (
  "id" text PRIMARY KEY NOT NULL,
  "household_id" text NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "reference_weight_kg" real NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "litter_cats_household_idx" ON "litter_cats" ("household_id");--> statement-breakpoint
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
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "litter_visits_device_time_uniq" ON "litter_visits" ("device_id", "occurred_at");
