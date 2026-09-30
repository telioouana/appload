ALTER TABLE "contract" ADD COLUMN "legacy_quote_id" text;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_legacy_quote_id_unique" UNIQUE("legacy_quote_id");