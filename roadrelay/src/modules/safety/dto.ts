import { IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export const REPORT_KINDS = [
  'harassment',
  'spam',
  'scam',
  'impersonation',
  'threats',
  'sexual_content',
  'illegal_activity',
  'other',
] as const;

export class CreateReportDto {
  @IsUUID('4')
  reportedUserId!: string;

  @IsEnum(REPORT_KINDS)
  kind!: (typeof REPORT_KINDS)[number];

  @IsOptional()
  @IsString()
  @Length(1, 1000)
  description?: string;

  @IsOptional()
  @IsUUID('4')
  contactRequestId?: string;

  @IsOptional()
  @IsUUID('4')
  relaySessionId?: string;

  @IsOptional()
  @IsUUID('4')
  vehicleId?: string;
}

export class CreateBlockDto {
  @IsUUID('4')
  blockedId!: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  reason?: string;
}
