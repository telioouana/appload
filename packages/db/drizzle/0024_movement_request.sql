CREATE TABLE "movement_request" (
	"id" text PRIMARY KEY NOT NULL,
	"movement_id" text NOT NULL,
	"carrier_org_id" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"message" text,
	"quote_subtotal" numeric(14, 2),
	"quote_vat" numeric(14, 2),
	"quote_total" numeric(14, 2),
	"quote_currency" "currency_enum",
	"quote_fiscal_regime" "fiscal_regime_enum",
	"note" text,
	"created_by" text,
	"responded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "movement_request_quote_currency_ck" CHECK ("movement_request"."quote_total" is null or "movement_request"."quote_currency" is not null)
);
--> statement-breakpoint
ALTER TABLE "movement_request" ADD CONSTRAINT "movement_request_movement_id_movement_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."movement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_request" ADD CONSTRAINT "movement_request_carrier_org_id_organization_id_fk" FOREIGN KEY ("carrier_org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_request" ADD CONSTRAINT "movement_request_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "movement_request_movement_carrier_uidx" ON "movement_request" USING btree ("movement_id","carrier_org_id");--> statement-breakpoint
CREATE INDEX "movement_request_carrier_status_idx" ON "movement_request" USING btree ("carrier_org_id","status");