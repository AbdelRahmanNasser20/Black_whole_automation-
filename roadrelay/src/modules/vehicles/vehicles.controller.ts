import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RateLimit, RateLimitGuard } from '@common/guards/rate-limit.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@common/types/auth.types';

import { VehiclesService } from './vehicles.service';
import { VehicleVerificationService } from './vehicle-verification.service';
import {
  AddVehicleDto,
  CompleteUploadDto,
  RequestUploadUrlDto,
  UpdateVisibilityDto,
} from './dto';

@Controller('vehicles')
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class VehiclesController {
  constructor(
    private readonly vehicles: VehiclesService,
    private readonly verification: VehicleVerificationService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ bucket: 'vehicles.create', limit: 5, windowSeconds: 3600 })
  async addVehicle(@CurrentUser() user: AuthenticatedUser, @Body() dto: AddVehicleDto) {
    const vehicle = await this.vehicles.create({ userId: user.id, ...dto });
    return { vehicle };
  }

  @Get()
  async listVehicles(@CurrentUser() user: AuthenticatedUser) {
    const vehicles = await this.vehicles.listForUser(user.id);
    return { vehicles };
  }

  @Patch(':id/visibility')
  async updateVisibility(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateVisibilityDto,
  ) {
    const vehicle = await this.vehicles.updateVisibility(user.id, id, dto.visibility);
    return { vehicle };
  }

  @Post(':id/verification-uploads')
  @RateLimit({ bucket: 'vehicles.upload_url', limit: 30, windowSeconds: 3600 })
  async requestUploadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RequestUploadUrlDto,
  ) {
    const result = await this.verification.requestUploadUrl(
      user.id,
      id,
      dto.kind,
      dto.contentType,
      dto.bytes,
    );
    return result;
  }

  @Post(':id/verification-artifacts')
  async registerArtifact(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CompleteUploadDto & { kind: string },
  ) {
    const artifact = await this.verification.registerCompletedUpload(
      user.id,
      id,
      dto.kind,
      dto.storageKey,
      dto.contentType,
      dto.bytes,
      dto.sha256Hex,
    );
    return { artifact };
  }

  @Post(':id/submit-for-review')
  async submitForReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const vehicle = await this.vehicles.submitForReview(user.id, id);
    return { vehicle };
  }
}
