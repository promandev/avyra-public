CREATE TABLE IF NOT EXISTS "shopping_list_prefs" (
  "household_id" text PRIMARY KEY NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "list_order" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
