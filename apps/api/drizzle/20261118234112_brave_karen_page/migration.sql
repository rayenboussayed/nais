DROP INDEX "translations_language_key_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "translations_language_key_unique" ON "translations" ("language_id","key") WHERE ("deleted_at" is null);