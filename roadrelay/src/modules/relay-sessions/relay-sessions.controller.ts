import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@common/types/auth.types';

import { RelaySessionsService } from './relay-sessions.service';

@Controller('relay-sessions')
@UseGuards(JwtAuthGuard)
export class RelaySessionsController {
  constructor(private readonly service: RelaySessionsService) {}

  @Get(':id')
  async fetch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const session = await this.service.getSession(user.id, id);
    // Strip raw participant ids; only aliases are exposed.
    const myAlias = session.participantAId === user.id
      ? session.participantAAlias
      : session.participantBAlias;
    const peerAlias = session.participantAId === user.id
      ? session.participantBAlias
      : session.participantAAlias;
    return {
      session: {
        id: session.id,
        status: session.status,
        provider: session.provider,
        myAlias,
        peerAlias,
        expiresAt: session.expiresAt,
      },
    };
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.NO_CONTENT)
  async end(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.service.endSession(user.id, id, 'user_ended');
  }
}
