ALTER TABLE "streaming_miner_snapshot" ADD COLUMN IF NOT EXISTS "viewer_on" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "streaming_miner_snapshot" ADD COLUMN IF NOT EXISTS "viewer_device_id" text;--> statement-breakpoint
ALTER TABLE "streaming_miner_snapshot" ADD COLUMN IF NOT EXISTS "viewer_user_id" text;--> statement-breakpoint
ALTER TABLE "streaming_miner_snapshot" ADD COLUMN IF NOT EXISTS "viewer_session_key" text;--> statement-breakpoint
ALTER TABLE "streaming_miner_snapshot" ADD COLUMN IF NOT EXISTS "viewer_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "streaming_miner_snapshot" ADD COLUMN IF NOT EXISTS "viewer_last_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "streaming_miner_snapshot" ADD COLUMN IF NOT EXISTS "viewer_last_note" text;
