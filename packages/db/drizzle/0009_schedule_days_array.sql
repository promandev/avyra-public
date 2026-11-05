ALTER TABLE "thermostat_schedules" ADD COLUMN IF NOT EXISTS "days_of_week" integer[];--> statement-breakpoint
UPDATE "thermostat_schedules" SET "days_of_week" = ARRAY["day_of_week"];--> statement-breakpoint
ALTER TABLE "thermostat_schedules" ALTER COLUMN "days_of_week" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "thermostat_schedules" DROP COLUMN IF EXISTS "day_of_week";
