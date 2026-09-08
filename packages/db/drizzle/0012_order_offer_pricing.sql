ALTER TABLE "order_offer" ADD COLUMN "commission_subtotal" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "order_offer" ADD COLUMN "commission_vat" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "order_offer" ADD COLUMN "commission_total" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "order_offer" ADD COLUMN "client_subtotal" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "order_offer" ADD COLUMN "client_vat" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "order_offer" ADD COLUMN "client_total" numeric(14, 2);