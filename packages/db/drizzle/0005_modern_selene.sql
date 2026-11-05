CREATE TABLE IF NOT EXISTS "camera_motion_events" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"type" text DEFAULT 'motion' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_accounts" (
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tablet_agents" (
	"device_id" text PRIMARY KEY NOT NULL,
	"pairing_secret_enc" text,
	"token_hash" text,
	"status" text DEFAULT 'unpaired' NOT NULL,
	"pending_command" text,
	"paired_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "camera_motion_events" ADD CONSTRAINT "camera_motion_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tablet_agents" ADD CONSTRAINT "tablet_agents_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "camera_motion_events_device_idx" ON "camera_motion_events" USING btree ("device_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_accounts_user_idx" ON "oauth_accounts" USING btree ("user_id");