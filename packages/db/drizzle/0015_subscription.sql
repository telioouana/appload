CREATE TABLE "subscription_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"period" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization" ALTER COLUMN "subscription_plan" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "organization" ALTER COLUMN "subscription_plan" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_usage" ADD CONSTRAINT "subscription_usage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_usage_entity_uq" ON "subscription_usage" USING btree ("organization_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "subscription_usage_period_idx" ON "subscription_usage" USING btree ("organization_id","period");--> statement-breakpoint
UPDATE "organization" SET "subscription_plan" = CASE "subscription_plan" WHEN 'pro' THEN 'business' ELSE NULL END WHERE "subscription_plan" IN ('free', 'pro');