CREATE TABLE "movement_tracking_alert" (
	"id" text PRIMARY KEY NOT NULL,
	"movement_id" text NOT NULL,
	"slot_date" text NOT NULL,
	"slot" text NOT NULL,
	"issue" text NOT NULL,
	"streak" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "movement_tracking_alert" ADD CONSTRAINT "movement_tracking_alert_movement_id_movement_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."movement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "movement_tracking_alert_slot_uidx" ON "movement_tracking_alert" USING btree ("movement_id","slot_date","slot");