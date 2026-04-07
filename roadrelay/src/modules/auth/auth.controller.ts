import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';

import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RateLimit, RateLimitGuard } from '@common/guards/rate-limit.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@common/types/auth.types';

import { AuthService } from './auth.service';
import { UsersService } from '@modules/users/users.service';
import { CompleteVerificationDto, StartVerificationDto } from './dto';

@Controller('auth')
@UseGuards(RateLimitGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  /**
   * Step 1 — request an OTP. Aggressively rate-limited per IP and per
   * phone number to prevent SMS bombing and enumeration.
   */
  @Post('start-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit({ bucket: 'auth.start', limit: 5, windowSeconds: 60, by: 'ip' })
  async startVerification(@Body() dto: StartVerificationDto, @Req() req: Request) {
    const result = await this.auth.startVerification(dto.phoneNumber, req.ip);
    return {
      challengeId: result.challengeId,
      expiresAt: result.expiresAt.toISOString(),
      resendCooldownSeconds: result.resendCooldownSeconds,
      // Stub-mode dev convenience only:
      ...(result.devCode ? { devCode: result.devCode } : {}),
    };
  }

  /**
   * Step 2 — submit the OTP. On success returns access + refresh tokens.
   */
  @Post('complete-verification')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ bucket: 'auth.complete', limit: 10, windowSeconds: 60, by: 'ip' })
  async completeVerification(@Body() dto: CompleteVerificationDto, @Req() req: Request) {
    const result = await this.auth.completeVerification(dto.phoneNumber, dto.code, {
      installId: dto.installId,
      platform: dto.platform,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return {
      user: result.user,
      isNewUser: result.isNewUser,
      tokens: {
        access: result.tokens.accessToken,
        refresh: result.tokens.refreshToken,
        accessExpiresAt: result.tokens.accessExpiresAt.toISOString(),
        refreshExpiresAt: result.tokens.refreshExpiresAt.toISOString(),
      },
    };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AuthenticatedUser) {
    const profile = await this.users.getProfile(user.id);
    return { user: profile };
  }
}
