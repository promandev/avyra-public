ALTER TABLE "thermostat_schedules" ADD COLUMN IF NOT EXISTS "hvac_mode" text DEFAULT 'heat' NOT NULL;--> statement-breakpoint
ALTER TABLE "thermostat_schedules" ALTER COLUMN "temperature" DROP NOT NULL;
