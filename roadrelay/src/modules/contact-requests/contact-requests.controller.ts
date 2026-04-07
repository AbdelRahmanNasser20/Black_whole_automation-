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
  Query,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RateLimit, RateLimitGuard } from '@common/guards/rate-limit.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@common/types/auth.types';

import { ContactRequestsService } from './contact-requests.service';
import { CreateContactRequestDto } from './dto';

@Controller('contact-requests')
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class ContactRequestsController {
  constructor(private readonly service: ContactRequestsService) {}

  /**
   * Create a contact request. Daily and hourly buckets prevent spam.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ bucket: 'cr.create.daily', limit: 10, windowSeconds: 86_400 })
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateContactRequestDto) {
    const request = await this.service.create({
      senderId: user.id,
      senderTrustScore: user.trustScore,
      vehicleId: dto.vehicleId,
      intent: dto.intent,
      message: dto.message,
    });
    return { request };
  }

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('direction') direction: 'incoming' | 'outgoing' = 'incoming',
  ) {
    const requests =
      direction === 'outgoing'
        ? await this.service.listOutgoing(user.id)
        : await this.service.listIncoming(user.id);
    return { requests };
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  async accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.accept(user.id, id);
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.NO_CONTENT)
  async decline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.service.decline(user.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.service.cancel(user.id, id);
  }

  @Post(':id/block')
  @HttpCode(HttpStatus.NO_CONTENT)
  async blockFromRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { reason?: string },
  ) {
    await this.service.blockFromRequest(user.id, id, body.reason);
  }
}
