CREATE TABLE "ai_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"task" varchar(64) NOT NULL,
	"model" varchar(255) NOT NULL,
	"key" varchar(255) NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "task" varchar(64) DEFAULT 'translate' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "payload" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_cache_task_model_key_unique" ON "ai_cache" ("task","model","key") WHERE ("deleted_at" is null);--> statement-breakpoint
CREATE INDEX "ai_cache_task_created_at_idx" ON "ai_cache" ("task","created_at");