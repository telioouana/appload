ALTER TABLE "order" DROP CONSTRAINT "order_truck_plate_truck_reg_plate_fk";
--> statement-breakpoint
ALTER TABLE "order" DROP CONSTRAINT "order_trailer_plate_trailer_reg_plate_fk";
--> statement-breakpoint
ALTER TABLE "order" DROP CONSTRAINT "order_link_plate_link_reg_plate_fk";
--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_truck_plate_truck_reg_plate_fk" FOREIGN KEY ("truck_plate") REFERENCES "public"."truck"("reg_plate") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_trailer_plate_trailer_reg_plate_fk" FOREIGN KEY ("trailer_plate") REFERENCES "public"."trailer"("reg_plate") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_link_plate_link_reg_plate_fk" FOREIGN KEY ("link_plate") REFERENCES "public"."link"("reg_plate") ON DELETE no action ON UPDATE cascade;