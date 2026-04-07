import { IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';

export class StartVerificationDto {
  // E.164 phone number
  @Matches(/^\+[1-9]\d{6,14}$/, { message: 'phone must be E.164' })
  phoneNumber!: string;
}

export class CompleteVerificationDto {
  @Matches(/^\+[1-9]\d{6,14}$/)
  phoneNumber!: string;

  @IsString()
  @Length(4, 8)
  code!: string;

  // Optional: bind this verification to a device install id.
  @IsOptional()
  @IsString()
  installId?: string;

  @IsOptional()
  @IsEnum(['ios', 'android', 'web'])
  platform?: 'ios' | 'android' | 'web';
}
