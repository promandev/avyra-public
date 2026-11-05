CREATE TABLE IF NOT EXISTS "streaming_miner_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"target_games" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_channel_id" integer,
	"preferred_channel_name" text,
	"auto_enabled" boolean DEFAULT false NOT NULL,
	"session_key" text,
	"session_started_at" timestamp with time zone,
	"join_after_min" integer,
	"leave_after_min" integer,
	"joined_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_tick_at" timestamp with time zone,
	"last_tick_note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
