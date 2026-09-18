CREATE TABLE "order_location" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"conversation_id" text,
	"chat_message_id" text,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"place_name" text,
	"source" text DEFAULT 'whatsapp' NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "order_location_chat_message_id_unique" UNIQUE("chat_message_id"),
	CONSTRAINT "order_location_latlng_ck" CHECK (latitude between -90 and 90 and longitude between -180 and 180)
);
--> statement-breakpoint
CREATE TABLE "order_route" (
	"order_id" text PRIMARY KEY NOT NULL,
	"origin_place_id" text NOT NULL,
	"destination_place_id" text NOT NULL,
	"origin_lat" double precision NOT NULL,
	"origin_lng" double precision NOT NULL,
	"destination_lat" double precision NOT NULL,
	"destination_lng" double precision NOT NULL,
	"encoded_polyline" text,
	"distance_meters" integer,
	"duration_seconds" integer,
	"source" text NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_location" ADD CONSTRAINT "order_location_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_location" ADD CONSTRAINT "order_location_conversation_id_chat_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_location" ADD CONSTRAINT "order_location_chat_message_id_chat_message_id_fk" FOREIGN KEY ("chat_message_id") REFERENCES "public"."chat_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_route" ADD CONSTRAINT "order_route_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_location_order_recorded_idx" ON "order_location" USING btree ("order_id","recorded_at");