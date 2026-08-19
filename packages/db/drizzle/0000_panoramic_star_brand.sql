CREATE TYPE "public"."fleet_enum" AS ENUM('active', 'idle', 'free');--> statement-breakpoint
CREATE TYPE "public"."truck_enum" AS ENUM('articulated', 'non-articulated');--> statement-breakpoint
CREATE TYPE "public"."categories_enum" AS ENUM('agriculture-inputs', 'agriculture-products', 'construction', 'machinery-equipment', 'fmcg', 'general-cargo', 'medicine', 'mining', 'oil-gas', 'vehicles', 'other');--> statement-breakpoint
CREATE TYPE "public"."confirmation_enum" AS ENUM('no', 'yes');--> statement-breakpoint
CREATE TYPE "public"."currency_enum" AS ENUM('MZN', 'ZAR', 'USD');--> statement-breakpoint
CREATE TYPE "public"."fiscal_regime_enum" AS ENUM('normal', 'simplified-5', 'simplified-3', 'n/a');--> statement-breakpoint
CREATE TYPE "public"."insurance_payment_status_enum" AS ENUM('pending', 'paid', 'not-applicable');--> statement-breakpoint
CREATE TYPE "public"."load_type_enum" AS ENUM('dedicated', 'groupage');--> statement-breakpoint
CREATE TYPE "public"."loading_bay_enum" AS ENUM('flatbed', 'dropsides', 'tautliner', 'rigid-body', 'refrigerated', 'tipper', 'side-tipper', 'tanker', 'lowbed');--> statement-breakpoint
CREATE TYPE "public"."order_status_enum" AS ENUM('prospect', 'booked', 'to-loading', 'at-loading', 'loading', 'waiting-documents', 'on-route', 'stopped', 'issue', 'at-border', 'at-offloading', 'offloading', 'delivered', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."packing_enum" AS ENUM('bags-1kg', 'bags-2kg', 'bags-5kg', 'bags-25kg', 'bags-30kg', 'bags-50kg', 'bags-100kg', 'bags-1ton', 'bottle-1l', 'bottle-5l', 'bottle-10l', 'bottle-20l', 'bottle-25l', 'container-20ft', 'container-40ft', 'boxes', 'pallets', 'noPacking', 'other');--> statement-breakpoint
CREATE TYPE "public"."payment_status_enum" AS ENUM('pending', 'partially', 'completed', 'not-applicable');--> statement-breakpoint
CREATE TYPE "public"."pod_status_enum" AS ENUM('pending-collection', 'pending-delivery', 'delivered', 'verified');--> statement-breakpoint
CREATE TYPE "public"."route_type_enum" AS ENUM('national', 'regional');--> statement-breakpoint
CREATE TYPE "public"."trip_type_enum" AS ENUM('backload', 'normal');--> statement-breakpoint
CREATE TYPE "public"."truck_age_enum" AS ENUM('recent', 'not-recent');--> statement-breakpoint
CREATE TYPE "public"."weight_unit_enum" AS ENUM('ton', 'kg', 'liter');--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text,
	"session_id" text,
	"organization_id" text,
	"entity_type" text,
	"entity_id" text,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'success' NOT NULL,
	"error_code" text,
	"ip_address" text,
	"user_agent" text,
	"city" text,
	"country" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"driver_name" text NOT NULL,
	"driver_phone" text NOT NULL,
	"order_id" text,
	"last_message_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chat_conversation_driver_phone_unique" UNIQUE("driver_phone")
);
--> statement-breakpoint
CREATE TABLE "chat_message" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"direction" text NOT NULL,
	"body" text NOT NULL,
	"status" text,
	"external_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracking_request" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
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
CREATE TABLE "driver" (
	"id" text PRIMARY KEY NOT NULL,
	"legacy_id" serial NOT NULL,
	"user_id" text NOT NULL,
	"carrier_id" text NOT NULL,
	"truck_id" text,
	"passport" text,
	"driver_card" jsonb,
	"passport_card" jsonb,
	"status" "fleet_enum" DEFAULT 'idle' NOT NULL,
	"kyc_status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "driver_legacy_id_unique" UNIQUE("legacy_id"),
	CONSTRAINT "driver_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "link" (
	"id" text PRIMARY KEY NOT NULL,
	"legacy_id" serial NOT NULL,
	"internal_id" text,
	"carrier_id" text NOT NULL,
	"trailer_id" text,
	"reg_plate" text NOT NULL,
	"brand" text NOT NULL,
	"model" text NOT NULL,
	"year" integer NOT NULL,
	"loading_bay" jsonb NOT NULL,
	"vin" text NOT NULL,
	"booklet" jsonb,
	"license" jsonb,
	"status" "fleet_enum" DEFAULT 'idle' NOT NULL,
	"kyc_status" text DEFAULT 'draft' NOT NULL,
	"ownership_status" text DEFAULT 'unverified' NOT NULL,
	"owner_name" text,
	"owner_nuit" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "link_legacy_id_unique" UNIQUE("legacy_id"),
	CONSTRAINT "link_reg_plate_unique" UNIQUE("reg_plate"),
	CONSTRAINT "link_vin_unique" UNIQUE("vin")
);
--> statement-breakpoint
CREATE TABLE "trailer" (
	"id" text PRIMARY KEY NOT NULL,
	"legacy_id" serial NOT NULL,
	"internal_id" text,
	"carrier_id" text NOT NULL,
	"truck_id" text,
	"reg_plate" text NOT NULL,
	"brand" text NOT NULL,
	"model" text NOT NULL,
	"year" integer NOT NULL,
	"loading_bay" jsonb NOT NULL,
	"vin" text NOT NULL,
	"booklet" jsonb,
	"license" jsonb,
	"status" "fleet_enum" DEFAULT 'idle' NOT NULL,
	"kyc_status" text DEFAULT 'draft' NOT NULL,
	"ownership_status" text DEFAULT 'unverified' NOT NULL,
	"owner_name" text,
	"owner_nuit" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trailer_legacy_id_unique" UNIQUE("legacy_id"),
	CONSTRAINT "trailer_reg_plate_unique" UNIQUE("reg_plate"),
	CONSTRAINT "trailer_vin_unique" UNIQUE("vin")
);
--> statement-breakpoint
CREATE TABLE "truck" (
	"id" text PRIMARY KEY NOT NULL,
	"legacy_id" serial NOT NULL,
	"internal_id" text,
	"carrier_id" text NOT NULL,
	"reg_plate" text NOT NULL,
	"brand" text NOT NULL,
	"model" text NOT NULL,
	"year" integer NOT NULL,
	"type" "truck_enum" NOT NULL,
	"loading_bay" jsonb,
	"vin" text NOT NULL,
	"booklet" jsonb,
	"license" jsonb,
	"status" "fleet_enum" DEFAULT 'idle' NOT NULL,
	"kyc_status" text DEFAULT 'draft' NOT NULL,
	"ownership_status" text DEFAULT 'unverified' NOT NULL,
	"owner_name" text,
	"owner_nuit" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "truck_legacy_id_unique" UNIQUE("legacy_id"),
	CONSTRAINT "truck_reg_plate_unique" UNIQUE("reg_plate"),
	CONSTRAINT "truck_vin_unique" UNIQUE("vin")
);
--> statement-breakpoint
CREATE TABLE "kyc_document" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"type" text NOT NULL,
	"pages" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"issued_at" date,
	"expires_at" date,
	"document_number" text,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"rejection_reason" text,
	"supersedes_id" text,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" text
);
--> statement-breakpoint
CREATE TABLE "order" (
	"id" text PRIMARY KEY NOT NULL,
	"legacy_id" serial NOT NULL,
	"order_id" text NOT NULL,
	"seq" integer NOT NULL,
	"year" integer NOT NULL,
	"shipper_name" text NOT NULL,
	"shipper_id" text NOT NULL,
	"loading_address" jsonb NOT NULL,
	"expected_loading_date" timestamp NOT NULL,
	"proposed_loading_date" timestamp,
	"arrival_at_loading" timestamp,
	"arrival_ontime_loading" boolean,
	"actual_loading_date" timestamp,
	"days_spend_not_loading" integer,
	"departure_loading_date" timestamp,
	"days_spend_loading" integer,
	"demurrage_at_loading" boolean DEFAULT false,
	"demurrage_charged_at_loading" boolean DEFAULT false,
	"demurrage_charge_days_at_loading" integer DEFAULT 0,
	"offloading_address" jsonb NOT NULL,
	"expected_offloading_date" timestamp,
	"proposed_offloading_date" timestamp,
	"arrival_at_offloading" timestamp,
	"arrival_ontime_offloading" boolean,
	"actual_offloading_date" timestamp,
	"days_spend_not_offloading" integer,
	"departure_offloading_date" timestamp,
	"days_spend_offloading" integer,
	"demurrage_at_offloading" boolean DEFAULT false,
	"demurrage_charged_at_offloading" boolean DEFAULT false,
	"demurrage_charge_days_at_offloading" integer DEFAULT 0,
	"arrival_at_border" timestamp,
	"departure_from_border" timestamp,
	"days_spend_at_border" integer,
	"demurrage_at_border" boolean DEFAULT false,
	"demurrage_charged_at_border" boolean DEFAULT false,
	"demurrage_charge_days_at_border" integer DEFAULT 0,
	"distance" integer,
	"days_spend_traveling" integer,
	"expected_trucks" integer DEFAULT 1,
	"category" "categories_enum" NOT NULL,
	"description" text NOT NULL,
	"weight" numeric(10, 3) NOT NULL,
	"loaded_weight" numeric(10, 3),
	"offloaded_weight" numeric(10, 3),
	"weight_unit" "weight_unit_enum" DEFAULT 'ton' NOT NULL,
	"packing" "packing_enum",
	"is_hazardous" boolean DEFAULT false,
	"hazchem_code" text,
	"is_refrigerated" boolean DEFAULT false,
	"temperature" numeric(10, 2),
	"temperature_instructions" text,
	"status" "order_status_enum" NOT NULL,
	"route" "route_type_enum" DEFAULT 'national' NOT NULL,
	"trip_type" "trip_type_enum" DEFAULT 'normal' NOT NULL,
	"load_type" "load_type_enum" NOT NULL,
	"deliveries" integer DEFAULT 1,
	"pod_status" "pod_status_enum",
	"carrier_name" text,
	"carrier_id" text,
	"driver_name" text,
	"driver_id" text,
	"driver_passport" text,
	"driver_phone_number" text,
	"truck_plate" text,
	"trailer_plate" text,
	"link_plate" text,
	"truck_age" "truck_age_enum",
	"deal_date" timestamp,
	"carrier_invoice_number" text,
	"carrier_invoice_date" timestamp,
	"fiscal_regime" "fiscal_regime_enum",
	"carrier_subtotal" numeric(14, 2),
	"carrier_vat" numeric(14, 2),
	"carrier_total" numeric(14, 2),
	"carrier_currency" "currency_enum" DEFAULT 'MZN',
	"carrier_paid_partially" "confirmation_enum",
	"carrier_paid_amount" numeric(14, 2),
	"carrier_paid_percentage" numeric(10, 2),
	"carrier_payment_status" "payment_status_enum",
	"carrier_remaining_amount" numeric(14, 2),
	"carrier_remaining_percentage" numeric(10, 2),
	"carrier_full_payment_date" timestamp,
	"insurance_subscriber" text,
	"insurance_value" numeric(14, 2),
	"insurance_currency" "currency_enum",
	"insurance_status" "insurance_payment_status_enum",
	"appload_commission_subtotal" numeric(14, 2),
	"appload_commission_vat" numeric(14, 2),
	"appload_commission_total" numeric(14, 2),
	"shipper_debit_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"shipper_credit_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"carrier_debit_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"carrier_credit_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"shipper_invoice_number" text,
	"shipper_invoice_date" timestamp,
	"shipper_subtotal" numeric(14, 2),
	"shipper_vat" numeric(14, 2),
	"shipper_total" numeric(14, 2),
	"shipper_currency" "currency_enum" DEFAULT 'MZN',
	"shipper_paid_partially" "confirmation_enum",
	"shipper_paid_amount" numeric(14, 2),
	"shipper_paid_percentage" numeric(10, 2),
	"shipper_payment_status" "payment_status_enum",
	"shipper_remaining_amount" numeric(14, 2),
	"shipper_remaining_percentage" numeric(10, 2),
	"shipper_full_payment_date" timestamp,
	"number_mechanical_failures_stops" integer DEFAULT 0,
	"total_mechanical_failures_delayed_days" integer,
	"number_documentation_issues_stops" integer DEFAULT 0,
	"total_documentation_issues_delayed_days" integer,
	"number_police_stops" integer DEFAULT 0,
	"total_police_delayed_days" integer,
	"number_accidents" integer DEFAULT 0,
	"cargo_damaged" boolean DEFAULT false,
	"damaged_percent" numeric,
	"claimed" boolean DEFAULT false,
	"age_factor" numeric,
	"load_factor" numeric,
	"default_coefficient" numeric,
	"cost_per_km" numeric,
	"cost_per_unit" numeric,
	"cost_per_unit_km" numeric,
	"total_fuel_cost" numeric,
	"version" integer DEFAULT 1 NOT NULL,
	"flagged_for_review" boolean DEFAULT false NOT NULL,
	"flag_reason" text,
	"flagged_at" timestamp,
	"flagged_by" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "order_legacy_id_unique" UNIQUE("legacy_id"),
	CONSTRAINT "order_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "order_document" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"type" text NOT NULL,
	"party" text,
	"title" text,
	"url" text NOT NULL,
	"size" integer,
	"mime_type" text,
	"subtotal" numeric(14, 2),
	"vat" numeric(14, 2),
	"total" numeric(14, 2),
	"currency" "currency_enum",
	"reason" text,
	"uploaded_by" text,
	"deleted_at" timestamp,
	"deleted_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "order_document_note_fields_chk" CHECK ("order_document"."type" not in ('debit-note', 'credit-note') or ("order_document"."party" is not null and "order_document"."total" is not null))
);
--> statement-breakpoint
CREATE TABLE "order_history" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"actor_user_id" text,
	"kind" text NOT NULL,
	"from_status" "order_status_enum",
	"to_status" "order_status_enum",
	"changed_fields" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_order" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"seq" integer NOT NULL,
	"year" integer NOT NULL,
	"shipper" text NOT NULL,
	"shipper_id" text,
	"carrier" text NOT NULL,
	"carrier_id" text,
	"deal_date" timestamp,
	"truck_plate" text NOT NULL,
	"link_plate" text,
	"trailer_plate" text,
	"loading_capacity" numeric(10, 3),
	"load_type" text,
	"truck_age" text,
	"driver_name" text NOT NULL,
	"driver_contact" text,
	"driver_passport" text,
	"driver_has_app" boolean DEFAULT false NOT NULL,
	"loading_pin" text,
	"loading_address" text NOT NULL,
	"loading_date" timestamp NOT NULL,
	"offloading_pin" text,
	"offloading_address" text NOT NULL,
	"offloading_date" timestamp,
	"distance" integer,
	"trip_type" text,
	"cargo_category" text,
	"cargo_description" text NOT NULL,
	"status" text NOT NULL,
	"published_on_app" boolean DEFAULT false NOT NULL,
	"fiscal_regime" text,
	"carrier_subtotal" numeric(14, 2),
	"carrier_vat" numeric(14, 2),
	"carrier_total" numeric(14, 2),
	"carrier_currency" text,
	"insurance_subscriber" text,
	"insurance_value" numeric(14, 2),
	"insurance_currency" text,
	"insurance_status" text,
	"commission_subtotal" numeric(14, 2),
	"commission_vat" numeric(14, 2),
	"commission_value" numeric(14, 2),
	"shipper_subtotal" numeric(14, 2),
	"shipper_vat" numeric(14, 2),
	"shipper_total" numeric(14, 2),
	"shipper_currency" text,
	"trip_kind" text,
	"returned_empty" boolean,
	"loaded_weight" numeric(10, 3),
	"offloaded_weight" numeric(10, 3),
	"deliveries" integer,
	"pod_status" text,
	"rating" integer,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ops_order_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "sheet_sync" (
	"order_id" text PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kyc" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"fiscal_regime" text,
	"id_card" jsonb,
	"nuit" jsonb,
	"alvara" jsonb,
	"bank_letter" jsonb,
	"republic_bulletin" jsonb,
	"commercial_exercise" jsonb,
	"commercial_certificate" jsonb,
	CONSTRAINT "kyc_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network" (
	"shipper_id" text NOT NULL,
	"carrier_id" text NOT NULL,
	CONSTRAINT "network_shipper_id_carrier_id_pk" PRIMARY KEY("shipper_id","carrier_id")
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	"subscription_plan" text DEFAULT 'free' NOT NULL,
	"nuit" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"email" text NOT NULL,
	"phone_number" text NOT NULL,
	"billing_address" jsonb,
	"physical_address" jsonb,
	"kyc_status" text DEFAULT 'draft' NOT NULL,
	"risk_level" text DEFAULT 'none' NOT NULL,
	"risk_reason" text,
	"risk_flagged_at" timestamp,
	"risk_flagged_by" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organization_nuit_unique" UNIQUE("nuit"),
	CONSTRAINT "organization_email_unique" UNIQUE("email"),
	CONSTRAINT "organization_phone_number_unique" UNIQUE("phone_number")
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text,
	"count" integer,
	"last_request" bigint
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"city" text,
	"country" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"phone_number" text,
	"phone_number_verified" boolean,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp,
	"two_factor_enabled" boolean DEFAULT false,
	"type" text NOT NULL,
	"gender" text,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_phone_number_unique" UNIQUE("phone_number")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_conversation" ADD CONSTRAINT "chat_conversation_order_id_order_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_conversation_id_chat_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_request" ADD CONSTRAINT "tracking_request_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_request" ADD CONSTRAINT "tracking_request_conversation_id_chat_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver" ADD CONSTRAINT "driver_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver" ADD CONSTRAINT "driver_carrier_id_organization_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver" ADD CONSTRAINT "driver_truck_id_truck_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."truck"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link" ADD CONSTRAINT "link_carrier_id_organization_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link" ADD CONSTRAINT "link_trailer_id_trailer_id_fk" FOREIGN KEY ("trailer_id") REFERENCES "public"."trailer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trailer" ADD CONSTRAINT "trailer_carrier_id_organization_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trailer" ADD CONSTRAINT "trailer_truck_id_truck_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."truck"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck" ADD CONSTRAINT "truck_carrier_id_organization_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_shipper_id_organization_id_fk" FOREIGN KEY ("shipper_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_carrier_id_organization_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_driver_id_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_truck_plate_truck_reg_plate_fk" FOREIGN KEY ("truck_plate") REFERENCES "public"."truck"("reg_plate") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_trailer_plate_trailer_reg_plate_fk" FOREIGN KEY ("trailer_plate") REFERENCES "public"."trailer"("reg_plate") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_link_plate_link_reg_plate_fk" FOREIGN KEY ("link_plate") REFERENCES "public"."link"("reg_plate") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_flagged_by_user_id_fk" FOREIGN KEY ("flagged_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_document" ADD CONSTRAINT "order_document_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_document" ADD CONSTRAINT "order_document_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_document" ADD CONSTRAINT "order_document_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_history" ADD CONSTRAINT "order_history_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_history" ADD CONSTRAINT "order_history_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_order" ADD CONSTRAINT "ops_order_shipper_id_organization_id_fk" FOREIGN KEY ("shipper_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_order" ADD CONSTRAINT "ops_order_carrier_id_organization_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_order" ADD CONSTRAINT "ops_order_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_sync" ADD CONSTRAINT "sheet_sync_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc" ADD CONSTRAINT "kyc_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network" ADD CONSTRAINT "network_shipper_id_organization_id_fk" FOREIGN KEY ("shipper_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network" ADD CONSTRAINT "network_carrier_id_organization_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_actor_created_idx" ON "activity_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_log_session_created_idx" ON "activity_log" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_log_action_idx" ON "activity_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "chat_message_conversation_idx" ON "chat_message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tracking_request_order_slot_attempt_uidx" ON "tracking_request" USING btree ("order_id","slot_date","slot","attempt");--> statement-breakpoint
CREATE INDEX "tracking_request_external_idx" ON "tracking_request" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "link_carrierId_idx" ON "link" USING btree ("carrier_id");--> statement-breakpoint
CREATE INDEX "link_plate_idx" ON "link" USING btree ("reg_plate");--> statement-breakpoint
CREATE INDEX "trailer_carrierId_idx" ON "trailer" USING btree ("carrier_id");--> statement-breakpoint
CREATE INDEX "trailer_plate_idx" ON "trailer" USING btree ("reg_plate");--> statement-breakpoint
CREATE INDEX "truck_carrierId_idx" ON "truck" USING btree ("carrier_id");--> statement-breakpoint
CREATE INDEX "truck_plate_idx" ON "truck" USING btree ("reg_plate");--> statement-breakpoint
CREATE INDEX "kyc_document_subject_idx" ON "kyc_document" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "kyc_document_status_idx" ON "kyc_document" USING btree ("status");--> statement-breakpoint
CREATE INDEX "kyc_document_expiry_idx" ON "kyc_document" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_year_seq_idx" ON "order" USING btree ("year","seq");--> statement-breakpoint
CREATE INDEX "order_document_order_type_idx" ON "order_document" USING btree ("order_id","type");--> statement-breakpoint
CREATE INDEX "order_history_order_created_idx" ON "order_history" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ops_order_year_seq_idx" ON "ops_order" USING btree ("year","seq");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "kyc_organizationId_idx" ON "kyc" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "rateLimit_key_idx" ON "rate_limit" USING btree ("key");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "twoFactor_secret_idx" ON "two_factor" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "twoFactor_userId_idx" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");