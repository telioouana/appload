ALTER TABLE "order" DROP COLUMN "carrier_paid_partially";--> statement-breakpoint
ALTER TABLE "order" DROP COLUMN "shipper_paid_partially";--> statement-breakpoint
DROP TYPE "public"."confirmation_enum";