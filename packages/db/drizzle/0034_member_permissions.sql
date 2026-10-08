CREATE TABLE "member_permission" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"kind" text NOT NULL,
	"permission" text,
	"starts_at" timestamp DEFAULT now() NOT NULL,
	"ends_at" timestamp,
	"granted_by" text,
	"revoked_at" timestamp,
	"revoked_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member" ALTER COLUMN "role" SET DEFAULT 'operations';--> statement-breakpoint
ALTER TABLE "member_permission" ADD CONSTRAINT "member_permission_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_permission" ADD CONSTRAINT "member_permission_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_permission" ADD CONSTRAINT "member_permission_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_permission" ADD CONSTRAINT "member_permission_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_permission_open_idx" ON "member_permission" USING btree ("member_id") WHERE "member_permission"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "member_permission_org_idx" ON "member_permission" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
-- The old lowest role becomes Operações (plan: today's members lose sight of prices; the CEO re-roles them)
UPDATE "member" SET "role" = 'operations' WHERE "role" = 'member';--> statement-breakpoint
UPDATE "invitation" SET "role" = 'operations' WHERE "role" = 'member';
