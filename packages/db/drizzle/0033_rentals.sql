CREATE TABLE "contract_payment" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"allocation_id" text,
	"leg" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" "currency_enum" NOT NULL,
	"paid_at" timestamp NOT NULL,
	"reference" text,
	"recorded_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contract_payment_amount_ck" CHECK ("contract_payment"."amount" <> 0)
);
--> statement-breakpoint
ALTER TABLE "contract_payment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rental_checkin_request" (
	"id" text PRIMARY KEY NOT NULL,
	"allocation_id" text NOT NULL,
	"conversation_id" text,
	"day" date NOT NULL,
	"attempt" integer NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"external_id" text,
	"error" text,
	"scheduled_for" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rental_checkin_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rental_day" (
	"id" text PRIMARY KEY NOT NULL,
	"allocation_id" text NOT NULL,
	"day" date NOT NULL,
	"state" text DEFAULT 'worked' NOT NULL,
	"note" text,
	"recorded_by" text,
	"recorded_org_id" text,
	"driver_answer" text,
	"answered_at" timestamp,
	"disputed_at" timestamp,
	"disputed_by" text,
	"dispute_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rental_day" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "contract_allocation_carrier_uidx";--> statement-breakpoint
DROP INDEX "contract_allocation_own_fleet_uidx";--> statement-breakpoint
ALTER TABLE "contract_allocation" ADD COLUMN "ends_on" date;--> statement-breakpoint
ALTER TABLE "contract_payment" ADD CONSTRAINT "contract_payment_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_payment" ADD CONSTRAINT "contract_payment_allocation_id_contract_allocation_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."contract_allocation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_payment" ADD CONSTRAINT "contract_payment_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_checkin_request" ADD CONSTRAINT "rental_checkin_request_allocation_id_contract_allocation_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."contract_allocation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_checkin_request" ADD CONSTRAINT "rental_checkin_request_conversation_id_chat_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_day" ADD CONSTRAINT "rental_day_allocation_id_contract_allocation_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."contract_allocation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_day" ADD CONSTRAINT "rental_day_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_day" ADD CONSTRAINT "rental_day_recorded_org_id_organization_id_fk" FOREIGN KEY ("recorded_org_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_day" ADD CONSTRAINT "rental_day_disputed_by_user_id_fk" FOREIGN KEY ("disputed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_payment_contract_idx" ON "contract_payment" USING btree ("contract_id","paid_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rental_checkin_request_attempt_uidx" ON "rental_checkin_request" USING btree ("allocation_id","day","attempt");--> statement-breakpoint
CREATE INDEX "rental_checkin_request_external_idx" ON "rental_checkin_request" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rental_day_line_day_uidx" ON "rental_day" USING btree ("allocation_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_allocation_truck_uidx" ON "contract_allocation" USING btree ("contract_id","truck_id") WHERE "contract_allocation"."truck_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_allocation_carrier_uidx" ON "contract_allocation" USING btree ("contract_id","carrier_org_id") WHERE "contract_allocation"."carrier_org_id" is not null and "contract_allocation"."truck_id" is null and "contract_allocation"."truck_plate" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_allocation_own_fleet_uidx" ON "contract_allocation" USING btree ("contract_id") WHERE "contract_allocation"."carrier_org_id" is null and "contract_allocation"."carrier_name" is null and "contract_allocation"."truck_id" is null and "contract_allocation"."truck_plate" is null;--> statement-breakpoint
CREATE POLICY "contract_payment_staff_policy" ON "contract_payment" AS PERMISSIVE FOR ALL TO "appload_staff" USING (exists (select 1 from "contract" c where c."id" = "contract_payment"."contract_id"));--> statement-breakpoint
CREATE POLICY "rental_checkin_request_staff_policy" ON "rental_checkin_request" AS PERMISSIVE FOR ALL TO "appload_staff" USING (exists (select 1 from "contract_allocation" a where a."id" = "rental_checkin_request"."allocation_id"));--> statement-breakpoint
CREATE POLICY "rental_checkin_request_service_policy" ON "rental_checkin_request" AS PERMISSIVE FOR ALL TO "appload_service" USING (true);--> statement-breakpoint
CREATE POLICY "rental_day_staff_policy" ON "rental_day" AS PERMISSIVE FOR ALL TO "appload_staff" USING (exists (select 1 from "contract_allocation" a where a."id" = "rental_day"."allocation_id"));--> statement-breakpoint
CREATE POLICY "rental_day_service_policy" ON "rental_day" AS PERMISSIVE FOR ALL TO "appload_service" USING (true);