CREATE TABLE IF NOT EXISTS "device_push_prefs" (
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "device_id" text NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
  "enabled" boolean NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "device_id")
);
