ALTER TABLE "contract" DROP CONSTRAINT "contract_period_ck";--> statement-breakpoint
ALTER TABLE "contract" ALTER COLUMN "ends_on" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_period_ck" CHECK ("contract"."ends_on" is null or "contract"."ends_on" >= "contract"."starts_on");