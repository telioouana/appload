CREATE TABLE "order_dispute" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"description" text NOT NULL,
	"claimed_amount" numeric(14, 2),
	"claimed_currency" "currency_enum",
	"liable_party" text,
	"hold_shipper_payments" boolean DEFAULT true NOT NULL,
	"hold_carrier_payments" boolean DEFAULT true NOT NULL,
	"carrier_debt_amount" numeric(14, 2),
	"carrier_debt_currency" "currency_enum",
	"deduction_terms" jsonb,
	"resolution" text,
	"opened_by" text,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "dispute_status" text;--> statement-breakpoint
ALTER TABLE "order_dispute" ADD CONSTRAINT "order_dispute_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_dispute" ADD CONSTRAINT "order_dispute_opened_by_user_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_dispute" ADD CONSTRAINT "order_dispute_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_dispute_order_idx" ON "order_dispute" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_dispute_status_idx" ON "order_dispute" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "order_dispute_active_uidx" ON "order_dispute" USING btree ("order_id") WHERE "order_dispute"."status" in ('open', 'under-review');