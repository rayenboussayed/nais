CREATE TYPE "ai_message_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "language_dir" AS ENUM('ltr', 'rtl');--> statement-breakpoint
CREATE TYPE "translation_namespace" AS ENUM('static', 'dynamic');--> statement-breakpoint
CREATE TABLE "ai_message_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"message_id" uuid NOT NULL,
	"role" varchar(10) NOT NULL,
	"prompt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"provider" varchar(50) DEFAULT 'ollama' NOT NULL,
	"model" varchar(50) NOT NULL,
	"status" "ai_message_status" DEFAULT 'pending'::"ai_message_status" NOT NULL,
	"response" text,
	"usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "languages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(255) NOT NULL,
	"native_name" varchar(255) NOT NULL,
	"iso639_1" varchar(2) NOT NULL,
	"dir" "language_dir" NOT NULL,
	"is_source" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"language_id" uuid NOT NULL,
	"namespace" "translation_namespace" DEFAULT 'dynamic'::"translation_namespace" NOT NULL,
	"key" varchar(255) NOT NULL,
	"text" text NOT NULL,
	"parent_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "ai_message_prompts_message_idx" ON "ai_message_prompts" ("message_id");--> statement-breakpoint
CREATE INDEX "ai_messages_created_idx" ON "ai_messages" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "languages_iso639_1_unique" ON "languages" ("iso639_1");--> statement-breakpoint
CREATE UNIQUE INDEX "translations_language_key_unique" ON "translations" ("language_id","key");--> statement-breakpoint
CREATE INDEX "translations_language_namespace_created_idx" ON "translations" ("language_id","namespace","created_at");--> statement-breakpoint
ALTER TABLE "ai_message_prompts" ADD CONSTRAINT "ai_message_prompts_message_id_ai_messages_id_fkey" FOREIGN KEY ("message_id") REFERENCES "ai_messages"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "translations" ADD CONSTRAINT "translations_language_id_languages_id_fkey" FOREIGN KEY ("language_id") REFERENCES "languages"("id");--> statement-breakpoint
ALTER TABLE "translations" ADD CONSTRAINT "translations_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "translations"("id") ON DELETE SET NULL;