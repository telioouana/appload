CREATE TABLE "order_dispatch" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"driver_id" text,
	"driver_name" text,
	"driver_phone_number" text,
	"driver_passport" text,
	"truck_id" text,
	"trailer_id" text,
	"link_id" text,
	"truck_plate" text,
	"trailer_plate" text,
	"link_plate" text,
	"dispatched_by" text,
	"dispatched_at" timestamp DEFAULT now() NOT NULL,
	"superseded_at" timestamp,
	"superseded_by" text
);
--> statement-breakpoint
CREATE TABLE "order_dispatch_document" (
	"dispatch_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"kyc_document_id" text NOT NULL,
	"type" text NOT NULL,
	"status_at_snapshot" text NOT NULL,
	"expires_at" date,
	CONSTRAINT "order_dispatch_document_dispatch_id_kyc_document_id_pk" PRIMARY KEY("dispatch_id","kyc_document_id")
);
--> statement-breakpoint
CREATE TABLE "order_loading_check" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"dispatch_id" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcome" text NOT NULL,
	"photo_document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"checked_by" text,
	"checked_by_org_id" text,
	"checked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_message_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "thread_message" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"sender_user_id" text,
	"sender_org_id" text,
	"body" text DEFAULT '' NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "thread_message_content_chk" CHECK (length("thread_message"."body") > 0 or jsonb_array_length("thread_message"."attachments") > 0)
);
--> statement-breakpoint
CREATE TABLE "thread_participant" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"organization_id" text,
	"staff" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_read" (
	"thread_id" text NOT NULL,
	"user_id" text NOT NULL,
	"last_read_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "thread_read_thread_id_user_id_pk" PRIMARY KEY("thread_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "order_dispatch" ADD CONSTRAINT "order_dispatch_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_dispatch" ADD CONSTRAINT "order_dispatch_driver_id_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_dispatch" ADD CONSTRAINT "order_dispatch_dispatched_by_user_id_fk" FOREIGN KEY ("dispatched_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_dispatch" ADD CONSTRAINT "order_dispatch_superseded_by_user_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_dispatch_document" ADD CONSTRAINT "order_dispatch_document_dispatch_id_order_dispatch_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."order_dispatch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_loading_check" ADD CONSTRAINT "order_loading_check_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_loading_check" ADD CONSTRAINT "order_loading_check_dispatch_id_order_dispatch_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."order_dispatch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_loading_check" ADD CONSTRAINT "order_loading_check_checked_by_user_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_loading_check" ADD CONSTRAINT "order_loading_check_checked_by_org_id_organization_id_fk" FOREIGN KEY ("checked_by_org_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_message" ADD CONSTRAINT "thread_message_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_message" ADD CONSTRAINT "thread_message_sender_user_id_user_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_message" ADD CONSTRAINT "thread_message_sender_org_id_organization_id_fk" FOREIGN KEY ("sender_org_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_participant" ADD CONSTRAINT "thread_participant_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_participant" ADD CONSTRAINT "thread_participant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_read" ADD CONSTRAINT "thread_read_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_read" ADD CONSTRAINT "thread_read_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_dispatch_order_idx" ON "order_dispatch" USING btree ("order_id","dispatched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_dispatch_open_uidx" ON "order_dispatch" USING btree ("order_id") WHERE "order_dispatch"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "order_dispatch_document_kyc_idx" ON "order_dispatch_document" USING btree ("kyc_document_id");--> statement-breakpoint
CREATE INDEX "order_loading_check_order_idx" ON "order_loading_check" USING btree ("order_id","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "thread_subject_uidx" ON "thread" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "thread_message_thread_created_idx" ON "thread_message" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "thread_participant_org_uidx" ON "thread_participant" USING btree ("thread_id","organization_id") WHERE "thread_participant"."organization_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "thread_participant_staff_uidx" ON "thread_participant" USING btree ("thread_id") WHERE "thread_participant"."staff";--> statement-breakpoint
CREATE INDEX "thread_participant_org_idx" ON "thread_participant" USING btree ("organization_id");