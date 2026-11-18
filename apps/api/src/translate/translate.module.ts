import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigModule } from '@nestjs/config';
import { AiModule } from '@nestjs/ai';
import { ResilienceModule } from '@nestjs/resilience';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

import type { Env } from '../config/env';

import { TranslateController } from './translate.controller';
import { TranslateService } from './translate.service';

/**
 * AI translation: @nestjs/ai over Ollama's OpenAI-compatible endpoint
 * (bonsai-2:2b by default). AiService covers the model-call timeout and
 * usage accounting; the `ollama` ResilienceModule preset (timeout, circuit
 * breaker, bounded-concurrency bulkhead) wraps the HTTP handler to protect
 * the GPU. No retry anywhere: a timeout hints at an overloaded model, retrying
 * makes it worse.
 */
@Module({
  imports: [
    ConfigModule,
    AiModule.forRootAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const baseURL = config.get('OLLAMA_BASE_URL', { infer: true });
        const model = config.get('OLLAMA_TEXT_MODEL', { infer: true });
        return {
          models: {
            default: createOpenAICompatible({
              name: 'ollama',
              baseURL: `${baseURL}/v1`,
              apiKey: 'ollama', // Ollama ignores credentials on its local endpoint
              supportsStructuredOutputs: false,
            })(model),
          },
          defaults: {
            timeout: config.get('OLLAMA_TIMEOUT_MS', { infer: true }),
            // No retry: translated text is expensive and POST is
            // not a safe method. Timeouts propagate to one attempt.
            retry: false,
            budget: { maxTokens: 8192 },
          },
        };
      },
    }),
    ResilienceModule.forRoot({
      defaults: { timeout: '45s' },
      presets: {
        ollama: {
          timeout: '45s',
          circuitBreaker: { failureRateThreshold: 50, minimumCalls: 10, openDuration: '30s' },
          bulkhead: { maxConcurrent: 2, maxQueue: 4, queueTimeout: '30s' },
        },
      },
    }),
  ],
  controllers: [TranslateController],
  providers: [TranslateService],
  exports: [TranslateService],
})
export class TranslateModule {}
