ALTER TABLE "contract" DROP CONSTRAINT "contract_committed_qty_ck";--> statement-breakpoint
ALTER TABLE "contract_allocation" DROP CONSTRAINT "contract_allocation_share_ck";--> statement-breakpoint
ALTER TABLE "contract" ALTER COLUMN "committed_qty" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_allocation" ALTER COLUMN "share_qty" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_committed_qty_ck" CHECK ("contract"."committed_qty" is null or "contract"."committed_qty" > 0);--> statement-breakpoint
ALTER TABLE "contract_allocation" ADD CONSTRAINT "contract_allocation_share_ck" CHECK ("contract_allocation"."share_qty" is null or "contract_allocation"."share_qty" > 0);