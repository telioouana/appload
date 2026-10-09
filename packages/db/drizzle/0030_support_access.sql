CREATE TABLE "support_access_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"granted_by" text,
	"reason" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"revoked_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_access_grant" ADD CONSTRAINT "support_access_grant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_access_grant" ADD CONSTRAINT "support_access_grant_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_access_grant" ADD CONSTRAINT "support_access_grant_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_access_grant_live_idx" ON "support_access_grant" USING btree ("organization_id","expires_at") WHERE "support_access_grant"."revoked_at" is null;--> statement-breakpoint
ALTER POLICY "partner_connection_staff_policy" ON "partner_connection" TO appload_staff USING ("partner_connection"."requester_org_id" = 'appload' or "partner_connection"."target_org_id" = 'appload' or exists (select 1 from "support_access_grant" g where g."organization_id" = "partner_connection"."requester_org_id" and g."revoked_at" is null and g."expires_at" > now()) or exists (select 1 from "support_access_grant" g where g."organization_id" = "partner_connection"."target_org_id" and g."revoked_at" is null and g."expires_at" > now()));--> statement-breakpoint
ALTER POLICY "contract_staff_policy" ON "contract" TO appload_staff USING ("contract"."organization_id" = 'appload' or "contract"."client_org_id" = 'appload' or exists (select 1 from "support_access_grant" g where g."organization_id" = "contract"."organization_id" and g."revoked_at" is null and g."expires_at" > now()));--> statement-breakpoint
ALTER POLICY "movement_staff_policy" ON "movement" TO appload_staff USING ("movement"."client_org_id" = 'appload' or "movement"."carrier_org_id" = 'appload' or exists (select 1 from "support_access_grant" g where g."organization_id" = "movement"."organization_id" and g."revoked_at" is null and g."expires_at" > now()));