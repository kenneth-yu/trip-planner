ALTER TABLE "ideas" ADD COLUMN "on_date" date;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "when_zone" text;