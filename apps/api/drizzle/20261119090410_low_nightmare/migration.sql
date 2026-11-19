ALTER TABLE "ai_cache" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "ai_cache" DROP COLUMN "deleted_at";--> statement-breakpoint
CREATE UNIQUE INDEX "ai_cache_task_model_key_unique" ON "ai_cache" ("task","model","key");