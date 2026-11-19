import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { AiModule } from '@nestjs/ai';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigModule } from '@nestjs/config';
import { ResilienceModule } from '@nestjs/resilience';

import type { Env } from '../../environment.js';

import { TranslateController } from './translate.controller.js';
import { TranslateService } from './translate.service.js';

/**
 * AI translation: `@nestjs/ai` over Ollama's OpenAI-compatible endpoint
 * (bonsai-2:2b by default). AiService covers the model-call timeout and
 * usage accounting; the `ollama` ResilienceModule preset (timeout, circuit
 * breaker, bounded-concurrency bulkhead) wraps the HTTP handler to protect
 * the GPU. No retry anywhere: a timeout hints at an overloaded model, retrying
 * makes it worse.
 */
@Module({
  controllers: [TranslateController],
  exports: [TranslateService],
  imports: [
    ConfigModule,
    AiModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      isGlobal: true,
      useFactory: (config: ConfigService<Env, true>) => {
        const baseURL = config.get('OLLAMA_BASE_URL', { infer: true });
        const model = config.get('OLLAMA_TEXT_MODEL', { infer: true });
        return {
          defaults: {
            budget: { maxTokens: 8192 },
            // No retry: translated text is expensive and POST is
            // not a safe method. Timeouts propagate to one attempt.
            retry: false,
            timeout: config.get('OLLAMA_TIMEOUT_MS', { infer: true }),
          },
          models: {
            default: createOpenAICompatible({
              apiKey: 'ollama', // Ollama ignores credentials on its local endpoint
              baseURL: `${baseURL}/v1`,
              name: 'ollama',
              supportsStructuredOutputs: false,
            })(model),
          },
        };
      },
    }),
    ResilienceModule.forRoot({
      defaults: { timeout: '45s' },
      presets: {
        ollama: {
          bulkhead: { maxConcurrent: 2, maxQueue: 4, queueTimeout: '30s' },
          circuitBreaker: { failureRateThreshold: 50, minimumCalls: 10, openDuration: '30s' },
          timeout: '45s',
        },
      },
    }),
  ],
  providers: [TranslateService],
})
export class TranslateModule {}
