CREATE TABLE "order_offer" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"carrier_id" text NOT NULL,
	"carrier_name" text NOT NULL,
	"fiscal_regime" "fiscal_regime_enum" NOT NULL,
	"subtotal" numeric(14, 2),
	"vat" numeric(14, 2),
	"total" numeric(14, 2) NOT NULL,
	"currency" "currency_enum" NOT NULL,
	"includes_git" boolean DEFAULT false NOT NULL,
	"includes_gps" boolean DEFAULT false NOT NULL,
	"notes" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"carrier_since" timestamp,
	"carrier_trips" integer,
	"decided_at" timestamp,
	"decided_by" text,
	"decision_note" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_offer" ADD CONSTRAINT "order_offer_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_offer" ADD CONSTRAINT "order_offer_carrier_id_organization_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_offer" ADD CONSTRAINT "order_offer_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_offer" ADD CONSTRAINT "order_offer_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_offer_order_idx" ON "order_offer" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_offer_accepted_uidx" ON "order_offer" USING btree ("order_id") WHERE "order_offer"."status" = 'accepted';