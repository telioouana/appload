ALTER TABLE "organization" ADD COLUMN "subscription_cancelled_at" timestamp;--> statement-breakpoint
-- Older plan notices predate the action the message now selects on: they were all plan changes
UPDATE "notification" SET "params" = "params" || '{"action":"change"}'::jsonb WHERE "kind" = 'subscription.changed' AND NOT "params" ? 'action';
