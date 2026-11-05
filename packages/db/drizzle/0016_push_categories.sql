ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "push_cameras" boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "push_lights" boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "push_vacuum" boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "push_heating" boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "push_ac" boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "push_printer" boolean NOT NULL DEFAULT true;
