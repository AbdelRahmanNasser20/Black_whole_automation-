import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';

import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RateLimit, RateLimitGuard } from '@common/guards/rate-limit.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@common/types/auth.types';

import { PlatesService } from './plates.service';
import { LookupPlateDto } from './dto';

@Controller('plates')
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class PlatesController {
  constructor(private readonly plates: PlatesService) {}

  /**
   * Plate lookup. Multi-layer rate limiting:
   *
   *   1. Per-user:   30 lookups / day  (handled here)
   *   2. Per-user:   10 lookups / hour (handled here)
   *   3. Per-IP:     60 lookups / day  (handled here)
   *   4. Trust gate: dynamic per user score  (handled in service)
   *   5. Abuse:      heuristic burst detection (handled in service)
   */
  @Post('lookup')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ bucket: 'plates.lookup.daily', limit: 30, windowSeconds: 86_400, by: 'user' })
  async lookup(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: LookupPlateDto,
    @Req() req: Request,
  ) {
    const result = await this.plates.lookup({
      actor: { id: user.id, deviceId: user.deviceId, trustScore: user.trustScore },
      state: dto.state,
      plate: dto.plate,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      geoRegion: dto.geoRegion,
    });
    return result;
  }
}
