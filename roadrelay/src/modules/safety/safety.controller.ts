import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RateLimit, RateLimitGuard } from '@common/guards/rate-limit.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@common/types/auth.types';

import { SafetyService } from './safety.service';
import { CreateBlockDto, CreateReportDto } from './dto';

@Controller('safety')
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class SafetyController {
  constructor(private readonly safety: SafetyService) {}

  @Post('reports')
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ bucket: 'safety.report', limit: 10, windowSeconds: 86_400 })
  async report(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReportDto) {
    const report = await this.safety.report({
      reporterId: user.id,
      reportedUserId: dto.reportedUserId,
      kind: dto.kind,
      description: dto.description,
      contactRequestId: dto.contactRequestId,
      relaySessionId: dto.relaySessionId,
      vehicleId: dto.vehicleId,
    });
    return { report };
  }

  @Post('blocks')
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ bucket: 'safety.block', limit: 50, windowSeconds: 86_400 })
  async block(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBlockDto) {
    await this.safety.block(user.id, dto.blockedId, dto.reason);
    return { ok: true };
  }

  @Delete('blocks/:blockedId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unblock(
    @CurrentUser() user: AuthenticatedUser,
    @Param('blockedId', new ParseUUIDPipe()) blockedId: string,
  ) {
    await this.safety.unblock(user.id, blockedId);
  }

  @Get('status')
  async status(@CurrentUser() user: AuthenticatedUser) {
    const status = await this.safety.getSafetyStatus(user.id);
    return { status };
  }
}
