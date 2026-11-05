CREATE TABLE IF NOT EXISTS "finance_debts" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "lender" text,
  "kind" text NOT NULL DEFAULT 'loan',
  "balance_cents" bigint,
  "balance_as_of" date NOT NULL,
  "monthly_payment_cents" bigint NOT NULL,
  "payment_day" integer,
  "annual_rate" real,
  "end_date" date,
  "rate_review_date" date,
  "match_text" text,
  "match_amount_cents" bigint,
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "finance_debts_owner_idx" ON "finance_debts" ("owner_user_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "finance_recurring" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "amount_cents" bigint NOT NULL,
  "day_of_month" integer,
  "match_text" text,
  "match_amount_cents" bigint,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "finance_recurring_owner_idx" ON "finance_recurring" ("owner_user_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "finance_imports" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "account" text NOT NULL,
  "rows_total" integer NOT NULL,
  "rows_new" integer NOT NULL,
  "rows_updated" integer NOT NULL,
  "date_from" date,
  "date_to" date,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "finance_imports_owner_idx" ON "finance_imports" ("owner_user_id", "created_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "finance_transactions" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "account" text NOT NULL,
  "value_date" date NOT NULL,
  "amount_cents" bigint NOT NULL,
  "balance_cents" bigint,
  "category" text,
  "subcategory" text,
  "description_enc" text NOT NULL,
  "comment_enc" text,
  "dedupe_key" text NOT NULL,
  "import_id" text REFERENCES "finance_imports"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "finance_transactions_dedupe_uniq" ON "finance_transactions" ("owner_user_id", "dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "finance_transactions_owner_date_idx" ON "finance_transactions" ("owner_user_id", "value_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "finance_transactions_import_idx" ON "finance_transactions" ("import_id");
