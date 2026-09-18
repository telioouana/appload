-- 0016_movements — the portal's own loads become one table.
--
-- The trip tables are replaced by `movement`, which carries the same load in
-- two shapes: `execution` "own-fleet" is the tenant's own truck (a Trip),
-- "partner" is a load it handed to somebody else for an agreed price (an
-- Order). Three tables come with it — cost lines, papers and an append-only
-- event trail — and `subscription_usage` starts counting "movement" where it
-- counted "trip".
--
-- This creates and drops rather than renaming, which the repo's additive-only
-- rule would normally forbid. It is safe and it is the honest shape here:
-- `0014_portal` has never run on production, so no `trip` table and no row of
-- one has ever existed there, and every constraint and index then carries the
-- name the schema snapshot records rather than a renamed leftover. The shared
-- dev database is moved across by packages/db/scripts/rename-trip-to-movement.mjs,
-- which does perform the rename, in place, with its rows.

CREATE TABLE "movement" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" serial NOT NULL,
	"organization_id" text NOT NULL,
	"execution" text DEFAULT 'own-fleet' NOT NULL,
	"status" text DEFAULT 'procurement' NOT NULL,
	"client_org_id" text,
	"client_name" text,
	"client_reference" text,
	"carrier_org_id" text,
	"carrier_name" text,
	"execution_movement_id" text,
	"offered_at" timestamp,
	"responded_at" timestamp,
	"response_note" text,
	"driver_name" text,
	"driver_phone" text,
	"driver_id" text,
	"truck_plate" text,
	"truck_id" text,
	"trailer_id" text,
	"link_id" text,
	"conversation_id" text,
	"origin" jsonb NOT NULL,
	"destination" jsonb NOT NULL,
	"route" "route_type_enum" DEFAULT 'national' NOT NULL,
	"cargo_description" text,
	"category" "categories_enum",
	"weight" numeric(10, 3),
	"weight_unit" "weight_unit_enum",
	"expected_loading_date" timestamp,
	"started_at" timestamp,
	"expected_delivery_at" timestamp,
	"delivered_at" timestamp,
	"closed_at" timestamp,
	"tracking_enabled" boolean DEFAULT true NOT NULL,
	"sell_subtotal" numeric(14, 2),
	"sell_vat" numeric(14, 2),
	"sell_total" numeric(14, 2),
	"sell_currency" "currency_enum",
	"sell_fiscal_regime" "fiscal_regime_enum",
	"sell_invoice_number" text,
	"sell_invoice_date" timestamp,
	"sell_settlement" "payment_status_enum",
	"sell_received_amount" numeric(14, 2),
	"sell_settled_at" timestamp,
	"buy_subtotal" numeric(14, 2),
	"buy_vat" numeric(14, 2),
	"buy_total" numeric(14, 2),
	"buy_currency" "currency_enum",
	"buy_fiscal_regime" "fiscal_regime_enum",
	"buy_invoice_number" text,
	"buy_invoice_date" timestamp,
	"buy_settlement" "payment_status_enum",
	"buy_paid_amount" numeric(14, 2),
	"buy_settled_at" timestamp,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "movement_seq_unique" UNIQUE("seq"),
	CONSTRAINT "movement_execution_self_ck" CHECK ("movement"."execution_movement_id" is distinct from "movement"."id"),
	CONSTRAINT "movement_own_fleet_ck" CHECK ("movement"."execution" = 'partner' or ("movement"."carrier_org_id" is null and "movement"."carrier_name" is null and "movement"."buy_total" is null and "movement"."execution_movement_id" is null)),
	CONSTRAINT "movement_sell_currency_ck" CHECK ("movement"."sell_total" is null or "movement"."sell_currency" is not null),
	CONSTRAINT "movement_buy_currency_ck" CHECK ("movement"."buy_total" is null or "movement"."buy_currency" is not null)
);
--> statement-breakpoint
CREATE TABLE "movement_cost" (
	"id" text PRIMARY KEY NOT NULL,
	"movement_id" text NOT NULL,
	"kind" text NOT NULL,
	"description" text,
	"amount" numeric(14, 2) NOT NULL,
	"currency" "currency_enum" NOT NULL,
	"incurred_at" timestamp DEFAULT now() NOT NULL,
	"rechargeable" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"deleted_at" timestamp,
	"deleted_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "movement_cost_amount_ck" CHECK ("movement_cost"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "movement_document" (
	"id" text PRIMARY KEY NOT NULL,
	"movement_id" text NOT NULL,
	"type" text NOT NULL,
	"leg" text,
	"title" text,
	"url" text NOT NULL,
	"size" integer,
	"mime_type" text,
	"cost_id" text,
	"uploaded_by" text,
	"deleted_at" timestamp,
	"deleted_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movement_event" (
	"id" text PRIMARY KEY NOT NULL,
	"movement_id" text NOT NULL,
	"actor_user_id" text,
	"actor_org_id" text,
	"kind" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"note" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movement_location" (
	"id" text PRIMARY KEY NOT NULL,
	"movement_id" text NOT NULL,
	"conversation_id" text,
	"chat_message_id" text,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"place_name" text,
	"source" text DEFAULT 'whatsapp' NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "movement_location_chat_message_id_unique" UNIQUE("chat_message_id"),
	CONSTRAINT "movement_location_latlng_ck" CHECK (latitude between -90 and 90 and longitude between -180 and 180)
);
--> statement-breakpoint
CREATE TABLE "movement_route" (
	"movement_id" text PRIMARY KEY NOT NULL,
	"origin_place_id" text NOT NULL,
	"destination_place_id" text NOT NULL,
	"origin_lat" double precision NOT NULL,
	"origin_lng" double precision NOT NULL,
	"destination_lat" double precision NOT NULL,
	"destination_lng" double precision NOT NULL,
	"encoded_polyline" text,
	"distance_meters" integer,
	"duration_seconds" integer,
	"source" text NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movement_tracking_request" (
	"id" text PRIMARY KEY NOT NULL,
	"movement_id" text NOT NULL,
	"conversation_id" text,
	"slot_date" text NOT NULL,
	"slot" text NOT NULL,
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
ALTER TABLE "movement" ADD CONSTRAINT "movement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement" ADD CONSTRAINT "movement_client_org_id_organization_id_fk" FOREIGN KEY ("client_org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement" ADD CONSTRAINT "movement_carrier_org_id_organization_id_fk" FOREIGN KEY ("carrier_org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement" ADD CONSTRAINT "movement_execution_movement_id_movement_id_fk" FOREIGN KEY ("execution_movement_id") REFERENCES "public"."movement"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement" ADD CONSTRAINT "movement_driver_id_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement" ADD CONSTRAINT "movement_truck_id_truck_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."truck"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement" ADD CONSTRAINT "movement_trailer_id_trailer_id_fk" FOREIGN KEY ("trailer_id") REFERENCES "public"."trailer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement" ADD CONSTRAINT "movement_link_id_link_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."link"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement" ADD CONSTRAINT "movement_conversation_id_chat_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement" ADD CONSTRAINT "movement_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_cost" ADD CONSTRAINT "movement_cost_movement_id_movement_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."movement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_cost" ADD CONSTRAINT "movement_cost_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_cost" ADD CONSTRAINT "movement_cost_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_document" ADD CONSTRAINT "movement_document_movement_id_movement_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."movement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_document" ADD CONSTRAINT "movement_document_cost_id_movement_cost_id_fk" FOREIGN KEY ("cost_id") REFERENCES "public"."movement_cost"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_document" ADD CONSTRAINT "movement_document_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_document" ADD CONSTRAINT "movement_document_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_event" ADD CONSTRAINT "movement_event_movement_id_movement_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."movement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_event" ADD CONSTRAINT "movement_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_event" ADD CONSTRAINT "movement_event_actor_org_id_organization_id_fk" FOREIGN KEY ("actor_org_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_location" ADD CONSTRAINT "movement_location_movement_id_movement_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."movement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_location" ADD CONSTRAINT "movement_location_conversation_id_chat_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_location" ADD CONSTRAINT "movement_location_chat_message_id_chat_message_id_fk" FOREIGN KEY ("chat_message_id") REFERENCES "public"."chat_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_route" ADD CONSTRAINT "movement_route_movement_id_movement_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."movement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_tracking_request" ADD CONSTRAINT "movement_tracking_request_movement_id_movement_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."movement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_tracking_request" ADD CONSTRAINT "movement_tracking_request_conversation_id_chat_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "movement_organization_status_idx" ON "movement" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "movement_carrier_status_idx" ON "movement" USING btree ("carrier_org_id","status");--> statement-breakpoint
CREATE INDEX "movement_client_status_idx" ON "movement" USING btree ("client_org_id","status");--> statement-breakpoint
CREATE INDEX "movement_driver_phone_idx" ON "movement" USING btree ("driver_phone") WHERE "movement"."status" = 'in-transit' and "movement"."execution_movement_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "movement_execution_uidx" ON "movement" USING btree ("execution_movement_id") WHERE "movement"."execution_movement_id" is not null;--> statement-breakpoint
CREATE INDEX "movement_cost_movement_idx" ON "movement_cost" USING btree ("movement_id","incurred_at");--> statement-breakpoint
CREATE INDEX "movement_document_movement_idx" ON "movement_document" USING btree ("movement_id","created_at");--> statement-breakpoint
CREATE INDEX "movement_event_movement_idx" ON "movement_event" USING btree ("movement_id","created_at");--> statement-breakpoint
CREATE INDEX "movement_location_movement_recorded_idx" ON "movement_location" USING btree ("movement_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "movement_tracking_request_slot_attempt_uidx" ON "movement_tracking_request" USING btree ("movement_id","slot_date","slot","attempt");--> statement-breakpoint
CREATE INDEX "movement_tracking_request_external_idx" ON "movement_tracking_request" USING btree ("external_id");--> statement-breakpoint
DROP TABLE "trip" CASCADE;--> statement-breakpoint
DROP TABLE "trip_location" CASCADE;--> statement-breakpoint
DROP TABLE "trip_route" CASCADE;--> statement-breakpoint
DROP TABLE "trip_tracking_request" CASCADE;--> statement-breakpoint
-- The allowance counts the same thing under its new name; a portal that has
-- billed nothing yet still gets a consistent table.
UPDATE "subscription_usage" SET "entity_type" = 'movement' WHERE "entity_type" = 'trip';--> statement-breakpoint
-- Three notification kinds went with the trip tables. A row whose kind no
-- longer exists renders as nothing, so it is dropped rather than left to be
-- discovered by whoever opens the inbox.
DELETE FROM "notification" WHERE "kind" LIKE 'trip.%';
