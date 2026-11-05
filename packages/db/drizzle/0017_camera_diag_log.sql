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
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "camera_diag_log_device_idx" ON "camera_diag_log" ("device_id", "occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "camera_diag_log_time_idx" ON "camera_diag_log" ("occurred_at");
