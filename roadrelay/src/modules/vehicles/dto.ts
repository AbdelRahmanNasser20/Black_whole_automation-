import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class AddVehicleDto {
  @Transform(upper)
  @IsString()
  @Length(1, 12)
  plate!: string;

  @Transform(upper)
  @Matches(/^[A-Z]{2}$/)
  state!: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  make?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  model?: string;

  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsString()
  @Length(1, 30)
  color?: string;

  @IsOptional()
  @IsString()
  @Length(4, 4)
  vinLastFour?: string;
}

export class UpdateVisibilityDto {
  @IsEnum(['public', 'private', 'hidden'])
  visibility!: 'public' | 'private' | 'hidden';
}

export class RequestUploadUrlDto {
  @IsEnum([
    'registration_doc',
    'insurance_card',
    'vehicle_photo_front',
    'vehicle_photo_rear',
    'vehicle_photo_vin',
    'driver_license',
    'other',
  ])
  kind!:
    | 'registration_doc'
    | 'insurance_card'
    | 'vehicle_photo_front'
    | 'vehicle_photo_rear'
    | 'vehicle_photo_vin'
    | 'driver_license'
    | 'other';

  @IsString()
  contentType!: string;

  @IsInt()
  @Min(1)
  @Max(20 * 1024 * 1024)
  bytes!: number;
}

export class CompleteUploadDto {
  @IsEnum([
    'registration_doc',
    'insurance_card',
    'vehicle_photo_front',
    'vehicle_photo_rear',
    'vehicle_photo_vin',
    'driver_license',
    'other',
  ])
  kind!:
    | 'registration_doc'
    | 'insurance_card'
    | 'vehicle_photo_front'
    | 'vehicle_photo_rear'
    | 'vehicle_photo_vin'
    | 'driver_license'
    | 'other';

  @IsString()
  storageKey!: string;

  @IsString()
  contentType!: string;

  @IsInt()
  @Min(1)
  bytes!: number;

  @IsString()
  @Length(64, 64)
  sha256Hex!: string;
}
