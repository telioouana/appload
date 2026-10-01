CREATE TABLE "contract" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" serial NOT NULL,
	"organization_id" text NOT NULL,
	"reference" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"basis" text NOT NULL,
	"client_org_id" text,
	"client_name" text,
	"client_reference" text,
	"origin" jsonb,
	"destination" jsonb,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"committed_qty" numeric(12, 3) NOT NULL,
	"weight_unit" "weight_unit_enum",
	"currency" "currency_enum" NOT NULL,
	"fiscal_regime" "fiscal_regime_enum",
	"sell_price" jsonb,
	"file_url" text,
	"file_name" text,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contract_seq_unique" UNIQUE("seq"),
	CONSTRAINT "contract_committed_qty_ck" CHECK ("contract"."committed_qty" > 0),
	CONSTRAINT "contract_period_ck" CHECK ("contract"."ends_on" >= "contract"."starts_on"),
	CONSTRAINT "contract_client_ck" CHECK ("contract"."client_org_id" is null or "contract"."client_org_id" <> "contract"."organization_id")
);
--> statement-breakpoint
ALTER TABLE "contract" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contract_allocation" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"carrier_org_id" text,
	"carrier_name" text,
	"share_qty" numeric(12, 3) NOT NULL,
	"buy_price" jsonb,
	"truck_id" text,
	"driver_id" text,
	"truck_plate" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contract_allocation_share_ck" CHECK ("contract_allocation"."share_qty" > 0),
	CONSTRAINT "contract_allocation_own_fleet_ck" CHECK ("contract_allocation"."carrier_org_id" is not null or "contract_allocation"."carrier_name" is not null or "contract_allocation"."buy_price" is null)
);
--> statement-breakpoint
ALTER TABLE "contract_allocation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "contract_allocation_id" text;--> statement-breakpoint
ALTER TABLE "movement" ADD COLUMN "contract_allocation_id" text;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_client_org_id_organization_id_fk" FOREIGN KEY ("client_org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_allocation" ADD CONSTRAINT "contract_allocation_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_allocation" ADD CONSTRAINT "contract_allocation_carrier_org_id_organization_id_fk" FOREIGN KEY ("carrier_org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_allocation" ADD CONSTRAINT "contract_allocation_truck_id_truck_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."truck"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_allocation" ADD CONSTRAINT "contract_allocation_driver_id_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_organization_status_idx" ON "contract" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "contract_client_idx" ON "contract" USING btree ("client_org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_reference_uidx" ON "contract" USING btree ("organization_id","reference") WHERE "contract"."reference" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_allocation_carrier_uidx" ON "contract_allocation" USING btree ("contract_id","carrier_org_id") WHERE "contract_allocation"."carrier_org_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_allocation_own_fleet_uidx" ON "contract_allocation" USING btree ("contract_id") WHERE "contract_allocation"."carrier_org_id" is null and "contract_allocation"."carrier_name" is null;--> statement-breakpoint
CREATE INDEX "contract_allocation_carrier_idx" ON "contract_allocation" USING btree ("carrier_org_id");--> statement-breakpoint
CREATE INDEX "contract_allocation_truck_idx" ON "contract_allocation" USING btree ("truck_id") WHERE "contract_allocation"."truck_id" is not null;--> statement-breakpoint
ALTER TABLE "movement" ADD CONSTRAINT "movement_contract_allocation_id_contract_allocation_id_fk" FOREIGN KEY ("contract_allocation_id") REFERENCES "public"."contract_allocation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "movement_contract_allocation_idx" ON "movement" USING btree ("contract_allocation_id") WHERE "movement"."contract_allocation_id" is not null;--> statement-breakpoint
CREATE POLICY "contract_staff_policy" ON "contract" AS PERMISSIVE FOR ALL TO "appload_staff" USING ("contract"."organization_id" = 'appload' or "contract"."client_org_id" = 'appload');--> statement-breakpoint
CREATE POLICY "contract_allocation_staff_policy" ON "contract_allocation" AS PERMISSIVE FOR ALL TO "appload_staff" USING ("contract_allocation"."carrier_org_id" = 'appload' or exists (select 1 from "contract" c where c."id" = "contract_allocation"."contract_id"));