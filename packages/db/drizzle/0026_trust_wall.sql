ALTER TABLE "partner_connection" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "thread" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "thread_message" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "thread_participant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "thread_read" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "movement" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "movement_cost" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "movement_dispute" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "movement_dispute_row" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "movement_document" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "movement_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "movement_location" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "movement_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "movement_route" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "movement_tracking_alert" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "movement_tracking_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "partner_connection_staff_policy" ON "partner_connection" AS PERMISSIVE FOR ALL TO "appload_staff" USING ("partner_connection"."requester_org_id" = 'appload' or "partner_connection"."target_org_id" = 'appload');--> statement-breakpoint
CREATE POLICY "thread_staff_policy" ON "thread" AS PERMISSIVE FOR ALL TO "appload_staff" USING ("thread"."subject_type" = 'order');--> statement-breakpoint
CREATE POLICY "thread_message_staff_policy" ON "thread_message" AS PERMISSIVE FOR ALL TO "appload_staff" USING (exists (select 1 from "thread" t where t."id" = "thread_message"."thread_id"));--> statement-breakpoint
CREATE POLICY "thread_participant_staff_policy" ON "thread_participant" AS PERMISSIVE FOR ALL TO "appload_staff" USING (exists (select 1 from "thread" t where t."id" = "thread_participant"."thread_id"));--> statement-breakpoint
CREATE POLICY "thread_read_staff_policy" ON "thread_read" AS PERMISSIVE FOR ALL TO "appload_staff" USING (exists (select 1 from "thread" t where t."id" = "thread_read"."thread_id"));--> statement-breakpoint
CREATE POLICY "movement_staff_policy" ON "movement" AS PERMISSIVE FOR ALL TO "appload_staff" USING ("movement"."client_org_id" = 'appload' or "movement"."carrier_org_id" = 'appload');--> statement-breakpoint
CREATE POLICY "movement_service_policy" ON "movement" AS PERMISSIVE FOR ALL TO "appload_service" USING (true);--> statement-breakpoint
CREATE POLICY "movement_cost_staff_policy" ON "movement_cost" AS PERMISSIVE FOR ALL TO "appload_staff" USING (exists (select 1 from "movement" m where m."id" = "movement_cost"."movement_id"));--> statement-breakpoint
CREATE POLICY "movement_dispute_staff_policy" ON "movement_dispute" AS PERMISSIVE FOR ALL TO "appload_staff" USING (exists (select 1 from "movement" m where m."id" = "movement_dispute"."movement_id"));--> statement-breakpoint
CREATE POLICY "movement_dispute_row_staff_policy" ON "movement_dispute_row" AS PERMISSIVE FOR ALL TO "appload_staff" USING (exists (select 1 from "movement" m where m."id" = "movement_dispute_row"."movement_id"));--> statement-breakpoint
CREATE POLICY "movement_document_staff_policy" ON "movement_document" AS PERMISSIVE FOR ALL TO "appload_staff" USING (exists (select 1 from "movement" m where m."id" = "movement_document"."movement_id"));--> statement-breakpoint
CREATE POLICY "movement_event_staff_policy" ON "movement_event" AS PERMISSIVE FOR ALL TO "appload_staff" USING (exists (select 1 from "movement" m where m."id" = "movement_event"."movement_id"));--> statement-breakpoint
CREATE POLICY "movement_location_staff_policy" ON "movement_location" AS PERMISSIVE FOR ALL TO "appload_staff" USING (exists (select 1 from "movement" m where m."id" = "movement_location"."movement_id"));--> statement-breakpoint
CREATE POLICY "movement_location_service_policy" ON "movement_location" AS PERMISSIVE FOR ALL TO "appload_service" USING (true);--> statement-breakpoint
CREATE POLICY "movement_request_staff_policy" ON "movement_request" AS PERMISSIVE FOR ALL TO "appload_staff" USING (exists (select 1 from "movement" m where m."id" = "movement_request"."movement_id"));--> statement-breakpoint
CREATE POLICY "movement_route_staff_policy" ON "movement_route" AS PERMISSIVE FOR ALL TO "appload_staff" USING (exists (select 1 from "movement" m where m."id" = "movement_route"."movement_id"));--> statement-breakpoint
CREATE POLICY "movement_route_service_policy" ON "movement_route" AS PERMISSIVE FOR ALL TO "appload_service" USING (true);--> statement-breakpoint
CREATE POLICY "movement_tracking_alert_staff_policy" ON "movement_tracking_alert" AS PERMISSIVE FOR ALL TO "appload_staff" USING (exists (select 1 from "movement" m where m."id" = "movement_tracking_alert"."movement_id"));--> statement-breakpoint
CREATE POLICY "movement_tracking_request_staff_policy" ON "movement_tracking_request" AS PERMISSIVE FOR ALL TO "appload_staff" USING (exists (select 1 from "movement" m where m."id" = "movement_tracking_request"."movement_id"));--> statement-breakpoint
CREATE POLICY "movement_tracking_request_service_policy" ON "movement_tracking_request" AS PERMISSIVE FOR ALL TO "appload_service" USING (true);