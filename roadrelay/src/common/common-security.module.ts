import { Global, Module } from '@nestjs/common';

import { RateLimitGuard } from './guards/rate-limit.guard';
import { RateLimitService } from './guards/rate-limit.service';
import { RolesGuard } from './guards/roles.guard';

/**
 * Cross-cutting security primitives. Marked @Global so any controller
 * can `@UseGuards(RateLimitGuard | RolesGuard)` without having to
 * import this module explicitly.
 *
 *  - RateLimitService depends on REDIS_RATE_LIMIT (provided by the
 *    @Global RedisModule).
 *  - RateLimitGuard depends on RateLimitService + the auto-provided
 *    Reflector.
 *  - RolesGuard depends only on the auto-provided Reflector.
 *
 * JwtAuthGuard lives in the @Global AuthModule because it shares
 * JwtService with token issuance.
 */
@Global()
@Module({
  providers: [RateLimitService, RateLimitGuard, RolesGuard],
  exports: [RateLimitService, RateLimitGuard, RolesGuard],
})
export class CommonSecurityModule {}
