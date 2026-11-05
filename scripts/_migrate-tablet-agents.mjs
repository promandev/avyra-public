import postgres from 'postgres';

const client = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS "tablet_agents" (
      "device_id" text PRIMARY KEY NOT NULL,
      "pairing_secret_enc" text,
      "token_hash" text,
      "status" text DEFAULT 'unpaired' NOT NULL,
      "pending_command" text,
      "paired_at" timestamp with time zone,
      "last_seen_at" timestamp with time zone
    );
  `);
  await client.unsafe(`
    DO $$ BEGIN
      ALTER TABLE "tablet_agents" ADD CONSTRAINT "tablet_agents_device_id_devices_id_fk"
        FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE cascade ON UPDATE no action;
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
  `);
  console.log('✓ tablet_agents creada correctamente');
} finally {
  await client.end();
}
