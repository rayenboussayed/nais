import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller.js';

/** Session login/logout routes (allowlisted by the request guard). */
@Module({
  controllers: [AuthController],
})
export class AuthModule {}
