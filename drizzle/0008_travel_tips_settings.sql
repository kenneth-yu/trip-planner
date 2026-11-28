ALTER TABLE "users" ADD COLUMN "tips_on" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tip_kinds_off" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tips_intro_seen" boolean DEFAULT false NOT NULL;