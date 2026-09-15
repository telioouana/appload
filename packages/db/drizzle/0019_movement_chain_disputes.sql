CREATE TABLE "movement_dispute" (
	"id" text PRIMARY KEY NOT NULL,
	"movement_id" text NOT NULL,
	"opened_by_org_id" text NOT NULL,
	"opened_by" text,
	"party_org_ids" text[] DEFAULT '{}' NOT NULL,
	"reason" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"resolved_by" text,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movement_dispute_row" (
	"dispute_id" text NOT NULL,
	"movement_id" text NOT NULL,
	"open" boolean DEFAULT true NOT NULL,
	CONSTRAINT "movement_dispute_row_dispute_id_movement_id_pk" PRIMARY KEY("dispute_id","movement_id")
);
--> statement-breakpoint
DROP INDEX "movement_driver_phone_idx";--> statement-breakpoint
ALTER TABLE "movement" ADD COLUMN "resume_status" text;--> statement-breakpoint
ALTER TABLE "movement_dispute" ADD CONSTRAINT "movement_dispute_movement_id_movement_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."movement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_dispute" ADD CONSTRAINT "movement_dispute_opened_by_org_id_organization_id_fk" FOREIGN KEY ("opened_by_org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_dispute" ADD CONSTRAINT "movement_dispute_opened_by_user_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_dispute" ADD CONSTRAINT "movement_dispute_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_dispute_row" ADD CONSTRAINT "movement_dispute_row_dispute_id_movement_dispute_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."movement_dispute"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_dispute_row" ADD CONSTRAINT "movement_dispute_row_movement_id_movement_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."movement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "movement_dispute_movement_idx" ON "movement_dispute" USING btree ("movement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "movement_dispute_row_open_uidx" ON "movement_dispute_row" USING btree ("movement_id") WHERE "movement_dispute_row"."open";--> statement-breakpoint
CREATE INDEX "movement_driver_phone_idx" ON "movement" USING btree ("driver_phone") WHERE status in ('at-loading','loading','waiting-documents','on-route','stopped','issue','at-border','at-offloading','offloading') and execution_movement_id is null;--> statement-breakpoint
UPDATE "movement" SET "status" = 'on-route' WHERE "status" = 'in-transit';--> statement-breakpoint
UPDATE "movement_event" SET "to_status" = 'on-route' WHERE "to_status" = 'in-transit';--> statement-breakpoint
UPDATE "movement_event" SET "from_status" = 'on-route' WHERE "from_status" = 'in-transit';