import {
  Body,
  Controller,
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
import { RolesGuard } from '@common/guards/roles.guard';
import { Roles } from '@common/decorators/roles.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@common/types/auth.types';

import { AdminService } from './admin.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'moderator')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('vehicles/pending')
  async pendingVehicles(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    const items = await this.admin.listPendingVehicles(
      Math.min(parseInt(limit ?? '50', 10), 200),
      Math.max(parseInt(offset ?? '0', 10), 0),
    );
    return { items };
  }

  @Post('vehicles/:id/approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.admin.approveVehicle(admin.id, id);
    return { ok: true };
  }

  @Post('vehicles/:id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { reason: string },
  ) {
    await this.admin.rejectVehicle(admin.id, id, body.reason ?? 'unspecified');
    return { ok: true };
  }

  @Get('reports/open')
  async openReports() {
    const items = await this.admin.listOpenReports();
    return { items };
  }

  @Post('reports/:id/action')
  @HttpCode(HttpStatus.OK)
  async actionReport(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { action: 'dismiss' | 'warn' | 'suspend' | 'ban'; note: string },
  ) {
    await this.admin.actionReport(admin.id, id, body.action, body.note ?? '');
    return { ok: true };
  }
}
