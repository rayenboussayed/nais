DROP INDEX "ai_messages_created_idx";--> statement-breakpoint
CREATE INDEX "ai_messages_created_at_id_idx" ON "ai_messages" ("created_at","id");--> statement-breakpoint
CREATE INDEX "languages_created_at_id_idx" ON "languages" ("created_at","id");--> statement-breakpoint
CREATE INDEX "translations_created_at_id_idx" ON "translations" ("created_at","id");