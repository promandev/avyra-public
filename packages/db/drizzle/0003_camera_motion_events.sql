CREATE TABLE IF NOT EXISTS "camera_motion_events" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"type" text DEFAULT 'motion' NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "camera_motion_events" ADD CONSTRAINT "camera_motion_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "camera_motion_events_device_idx" ON "camera_motion_events" USING btree ("device_id","occurred_at");
