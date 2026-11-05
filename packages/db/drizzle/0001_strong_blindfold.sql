CREATE TABLE IF NOT EXISTS "ac_units" (
	"device_id" text PRIMARY KEY NOT NULL,
	"model" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lights" (
	"device_id" text PRIMARY KEY NOT NULL,
	"model" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "thermostats" (
	"device_id" text PRIMARY KEY NOT NULL,
	"model" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ac_units" ADD CONSTRAINT "ac_units_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lights" ADD CONSTRAINT "lights_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "thermostats" ADD CONSTRAINT "thermostats_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
