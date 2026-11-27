CREATE TABLE "geocode_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"hit" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
