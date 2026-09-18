CREATE TABLE "organization_counter" (
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"year" integer NOT NULL,
	"last" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "organization_counter_organization_id_kind_year_pk" PRIMARY KEY("organization_id","kind","year")
);
--> statement-breakpoint
ALTER TABLE "movement" ADD COLUMN "order_id" text;--> statement-breakpoint
ALTER TABLE "movement" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "movement" ADD COLUMN "request_reference" text;--> statement-breakpoint
ALTER TABLE "organization_counter" ADD CONSTRAINT "organization_counter_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement" ADD CONSTRAINT "movement_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "movement_order_idx" ON "movement" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "movement_order_org_uidx" ON "movement" USING btree ("order_id","organization_id") WHERE "movement"."order_id" is not null and "movement"."status" <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "movement_reference_uidx" ON "movement" USING btree ("organization_id","reference") WHERE "movement"."reference" is not null;