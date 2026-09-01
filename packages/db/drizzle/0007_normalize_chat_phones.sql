-- Chat phones become canonical bare digits (matching Infobip's inbound
-- MSISDNs). Duplicate threads that only differed by formatting are merged
-- into one keeper (linked-to-order first, then most recent activity, then
-- oldest row), children repointed before the dupes are removed. Finally,
-- every active order with a driver phone gets its thread backfilled so
-- auto-initiation covers orders that predate the widened hooks.
WITH ranked AS (
    SELECT id, order_id, last_message_at,
           regexp_replace(driver_phone, '\D', '', 'g') AS digits,
           row_number() OVER (
               PARTITION BY regexp_replace(driver_phone, '\D', '', 'g')
               ORDER BY (order_id IS NOT NULL) DESC, last_message_at DESC, created_at ASC
           ) AS rn
    FROM chat_conversation
    WHERE regexp_replace(driver_phone, '\D', '', 'g') <> ''
),
dupes AS (
    SELECT d.id AS dupe_id, k.id AS keeper_id
    FROM ranked d JOIN ranked k ON k.digits = d.digits AND k.rn = 1
    WHERE d.rn > 1
)
UPDATE chat_message m SET conversation_id = dupes.keeper_id
FROM dupes WHERE m.conversation_id = dupes.dupe_id;
--> statement-breakpoint
WITH ranked AS (
    SELECT id, order_id, last_message_at,
           regexp_replace(driver_phone, '\D', '', 'g') AS digits,
           row_number() OVER (
               PARTITION BY regexp_replace(driver_phone, '\D', '', 'g')
               ORDER BY (order_id IS NOT NULL) DESC, last_message_at DESC, created_at ASC
           ) AS rn
    FROM chat_conversation
    WHERE regexp_replace(driver_phone, '\D', '', 'g') <> ''
),
dupes AS (
    SELECT d.id AS dupe_id, k.id AS keeper_id
    FROM ranked d JOIN ranked k ON k.digits = d.digits AND k.rn = 1
    WHERE d.rn > 1
)
UPDATE tracking_request t SET conversation_id = dupes.keeper_id
FROM dupes WHERE t.conversation_id = dupes.dupe_id;
--> statement-breakpoint
WITH ranked AS (
    SELECT id, order_id, last_message_at,
           regexp_replace(driver_phone, '\D', '', 'g') AS digits,
           row_number() OVER (
               PARTITION BY regexp_replace(driver_phone, '\D', '', 'g')
               ORDER BY (order_id IS NOT NULL) DESC, last_message_at DESC, created_at ASC
           ) AS rn
    FROM chat_conversation
    WHERE regexp_replace(driver_phone, '\D', '', 'g') <> ''
),
dupes AS (
    SELECT d.id AS dupe_id, k.id AS keeper_id
    FROM ranked d JOIN ranked k ON k.digits = d.digits AND k.rn = 1
    WHERE d.rn > 1
),
folded AS (
    SELECT dupes.keeper_id,
           max(c.last_message_at) AS dupe_last,
           min(c.order_id) FILTER (WHERE c.order_id IS NOT NULL) AS dupe_order
    FROM dupes JOIN chat_conversation c ON c.id = dupes.dupe_id
    GROUP BY dupes.keeper_id
)
UPDATE chat_conversation k
SET order_id = COALESCE(k.order_id, folded.dupe_order),
    last_message_at = GREATEST(k.last_message_at, folded.dupe_last)
FROM folded WHERE k.id = folded.keeper_id;
--> statement-breakpoint
WITH ranked AS (
    SELECT id, order_id, last_message_at,
           regexp_replace(driver_phone, '\D', '', 'g') AS digits,
           row_number() OVER (
               PARTITION BY regexp_replace(driver_phone, '\D', '', 'g')
               ORDER BY (order_id IS NOT NULL) DESC, last_message_at DESC, created_at ASC
           ) AS rn
    FROM chat_conversation
    WHERE regexp_replace(driver_phone, '\D', '', 'g') <> ''
),
dupes AS (
    SELECT d.id AS dupe_id
    FROM ranked d
    WHERE d.rn > 1
)
DELETE FROM chat_conversation c USING dupes WHERE c.id = dupes.dupe_id;
--> statement-breakpoint
UPDATE chat_conversation
SET driver_phone = regexp_replace(driver_phone, '\D', '', 'g')
WHERE driver_phone <> regexp_replace(driver_phone, '\D', '', 'g')
  AND regexp_replace(driver_phone, '\D', '', 'g') <> '';
--> statement-breakpoint
INSERT INTO chat_conversation (id, driver_name, driver_phone, order_id)
SELECT DISTINCT ON (regexp_replace(o.driver_phone_number, '\D', '', 'g'))
       gen_random_uuid(),
       COALESCE(o.driver_name, regexp_replace(o.driver_phone_number, '\D', '', 'g')),
       regexp_replace(o.driver_phone_number, '\D', '', 'g'),
       o.order_id
FROM "order" o
WHERE o.status IN ('booked','to-loading','at-loading','loading','waiting-documents',
                   'on-route','stopped','issue','at-border','at-offloading','offloading')
  AND o.driver_phone_number IS NOT NULL
  AND regexp_replace(o.driver_phone_number, '\D', '', 'g') <> ''
ORDER BY regexp_replace(o.driver_phone_number, '\D', '', 'g'), o.created_at DESC
ON CONFLICT (driver_phone) DO NOTHING;
