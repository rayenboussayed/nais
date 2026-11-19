import { Module } from '@nestjs/common';

import { TranslateModule } from '../translate/translate.module.js';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { PipelineLoader } from './pipeline-loader.js';

/**
 * General-purpose AI module: the task endpoints, the pipeline service
 * (registry + cache-aside + audit) and the lazy ONNX pipeline loader.
 */
@Module({
  imports: [TranslateModule],
  controllers: [AiController],
  providers: [AiService, PipelineLoader],
  exports: [AiService, PipelineLoader],
})
export class AiModule {}
