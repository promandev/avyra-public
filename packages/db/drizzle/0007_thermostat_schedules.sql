ALTER TABLE "thermostats" ADD COLUMN IF NOT EXISTS "temperature_scale" real DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "thermostat_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_time" text NOT NULL,
	"temperature" real NOT NULL,
	"ha_automation_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "thermostat_schedules" ADD CONSTRAINT "thermostat_schedules_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
