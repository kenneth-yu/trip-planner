ALTER TABLE "imported_items" ALTER COLUMN "raw" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "imported_items" ALTER COLUMN "proposed" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "item_private" ALTER COLUMN "data" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "sealed" text;--> statement-breakpoint
ALTER TABLE "imported_items" ADD COLUMN "sealed" text;--> statement-breakpoint
ALTER TABLE "item_private" ADD COLUMN "sealed" text;