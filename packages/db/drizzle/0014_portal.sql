CREATE TABLE "organization_claim" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"auto_approved" boolean DEFAULT false NOT NULL,
	"decided_by" text,
	"decided_at" timestamp,
	"decision_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"requester_org_id" text NOT NULL,
	"target_org_id" text NOT NULL,
	"relation" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"accepted_via" text,
	"message" text,
	"requested_by_user_id" text,
	"responded_by_user_id" text,
	"responded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "partner_connection_distinct_ck" CHECK ("partner_connection"."requester_org_id" <> "partner_connection"."target_org_id")
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp,
	"email_state" text DEFAULT 'none' NOT NULL,
	"email_attempts" integer DEFAULT 0 NOT NULL,
	"email_last_error" text,
	"dedupe_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_cursor" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"last_history_created_at" timestamp NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_request" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"carrier_org_id" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"message" text,
	"created_by" text,
	"responded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote" (
	"id" text PRIMARY KEY NOT NULL,
	"carrier_org_id" text NOT NULL,
	"client_org_id" text NOT NULL,
	"origin" jsonb NOT NULL,
	"destination" jsonb NOT NULL,
	"loading_date" timestamp,
	"route" "route_type_enum" DEFAULT 'national' NOT NULL,
	"loading_bay" "loading_bay_enum",
	"capacity_weight" numeric(10, 3),
	"capacity_unit" "weight_unit_enum",
	"fiscal_regime" "fiscal_regime_enum" NOT NULL,
	"subtotal" numeric(14, 2),
	"vat" numeric(14, 2),
	"total" numeric(14, 2) NOT NULL,
	"currency" "currency_enum" NOT NULL,
	"includes_git" boolean DEFAULT false NOT NULL,
	"includes_gps" boolean DEFAULT false NOT NULL,
	"notes" text,
	"valid_until" timestamp,
	"status" text DEFAULT 'sent' NOT NULL,
	"order_id" text,
	"created_by" text,
	"decided_by" text,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" serial NOT NULL,
	"organization_id" text NOT NULL,
	"counterparty_org_id" text,
	"driver_name" text NOT NULL,
	"driver_phone" text NOT NULL,
	"conversation_id" text,
	"truck_plate" text,
	"cargo_description" text,
	"origin" jsonb NOT NULL,
	"destination" jsonb NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"tracking_enabled" boolean DEFAULT true NOT NULL,
	"started_at" timestamp,
	"expected_delivery_at" timestamp,
	"delivered_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trip_seq_unique" UNIQUE("seq")
);
--> statement-breakpoint
CREATE TABLE "trip_location" (
	"id" text PRIMARY KEY NOT NULL,
	"trip_id" text NOT NULL,
	"conversation_id" text,
	"chat_message_id" text,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"place_name" text,
	"source" text DEFAULT 'whatsapp' NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trip_location_chat_message_id_unique" UNIQUE("chat_message_id"),
	CONSTRAINT "trip_location_latlng_ck" CHECK (latitude between -90 and 90 and longitude between -180 and 180)
);
--> statement-breakpoint
CREATE TABLE "trip_route" (
	"trip_id" text PRIMARY KEY NOT NULL,
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
CREATE TABLE "trip_tracking_request" (
	"id" text PRIMARY KEY NOT NULL,
	"trip_id" text NOT NULL,
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
ALTER TABLE "activity_log" ADD COLUMN "app" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "source" text DEFAULT 'admin' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "subscription_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "portal_activated_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization_claim" ADD CONSTRAINT "organization_claim_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_claim" ADD CONSTRAINT "organization_claim_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_claim" ADD CONSTRAINT "organization_claim_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_connection" ADD CONSTRAINT "partner_connection_requester_org_id_organization_id_fk" FOREIGN KEY ("requester_org_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_connection" ADD CONSTRAINT "partner_connection_target_org_id_organization_id_fk" FOREIGN KEY ("target_org_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_connection" ADD CONSTRAINT "partner_connection_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_connection" ADD CONSTRAINT "partner_connection_responded_by_user_id_user_id_fk" FOREIGN KEY ("responded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_cursor" ADD CONSTRAINT "notification_cursor_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_request" ADD CONSTRAINT "order_request_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_request" ADD CONSTRAINT "order_request_carrier_org_id_organization_id_fk" FOREIGN KEY ("carrier_org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_request" ADD CONSTRAINT "order_request_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_carrier_org_id_organization_id_fk" FOREIGN KEY ("carrier_org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_client_org_id_organization_id_fk" FOREIGN KEY ("client_org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_counterparty_org_id_organization_id_fk" FOREIGN KEY ("counterparty_org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_conversation_id_chat_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_location" ADD CONSTRAINT "trip_location_trip_id_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_location" ADD CONSTRAINT "trip_location_conversation_id_chat_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_location" ADD CONSTRAINT "trip_location_chat_message_id_chat_message_id_fk" FOREIGN KEY ("chat_message_id") REFERENCES "public"."chat_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_route" ADD CONSTRAINT "trip_route_trip_id_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_tracking_request" ADD CONSTRAINT "trip_tracking_request_trip_id_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_tracking_request" ADD CONSTRAINT "trip_tracking_request_conversation_id_chat_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_claim_pending_uidx" ON "organization_claim" USING btree ("organization_id") WHERE "organization_claim"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "organization_claim_user_idx" ON "organization_claim" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_connection_pair_uidx" ON "partner_connection" USING btree (least("requester_org_id", "target_org_id"),greatest("requester_org_id", "target_org_id"));--> statement-breakpoint
CREATE INDEX "partner_connection_target_status_idx" ON "partner_connection" USING btree ("target_org_id","status");--> statement-breakpoint
CREATE INDEX "partner_connection_requester_status_idx" ON "partner_connection" USING btree ("requester_org_id","status");--> statement-breakpoint
CREATE INDEX "notification_user_created_idx" ON "notification" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notification_user_unread_idx" ON "notification" USING btree ("user_id") WHERE "notification"."read_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_user_dedupe_uidx" ON "notification" USING btree ("user_id","dedupe_key") WHERE "notification"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "notification_email_pending_idx" ON "notification" USING btree ("email_state") WHERE "notification"."email_state" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "order_request_order_carrier_uidx" ON "order_request" USING btree ("order_id","carrier_org_id");--> statement-breakpoint
CREATE INDEX "order_request_carrier_status_idx" ON "order_request" USING btree ("carrier_org_id","status");--> statement-breakpoint
CREATE INDEX "quote_client_status_idx" ON "quote" USING btree ("client_org_id","status");--> statement-breakpoint
CREATE INDEX "quote_carrier_status_idx" ON "quote" USING btree ("carrier_org_id","status");--> statement-breakpoint
CREATE INDEX "trip_organization_status_idx" ON "trip" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "trip_counterparty_status_idx" ON "trip" USING btree ("counterparty_org_id","status");--> statement-breakpoint
CREATE INDEX "trip_driver_phone_idx" ON "trip" USING btree ("driver_phone") WHERE "trip"."status" = 'in-transit';--> statement-breakpoint
CREATE INDEX "trip_location_trip_recorded_idx" ON "trip_location" USING btree ("trip_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_tracking_request_trip_slot_attempt_uidx" ON "trip_tracking_request" USING btree ("trip_id","slot_date","slot","attempt");--> statement-breakpoint
CREATE INDEX "trip_tracking_request_external_idx" ON "trip_tracking_request" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "order_shipper_loading_idx" ON "order" USING btree ("shipper_id","expected_loading_date");--> statement-breakpoint
CREATE INDEX "order_carrier_loading_idx" ON "order" USING btree ("carrier_id","expected_loading_date");--> statement-breakpoint
CREATE INDEX "order_status_idx" ON "order" USING btree ("status");--> statement-breakpoint
CREATE INDEX "order_history_created_idx" ON "order_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "order_offer_carrier_status_idx" ON "order_offer" USING btree ("carrier_id","status");