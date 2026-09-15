ALTER TABLE "movement_document" ADD COLUMN "approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "movement_document" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "movement_document" ADD CONSTRAINT "movement_document_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;