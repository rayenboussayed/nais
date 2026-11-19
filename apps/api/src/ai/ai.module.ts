import { Module } from '@nestjs/common';

import { TranslateModule } from '../translate/translate.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { PipelineLoader } from './pipeline-loader';

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
