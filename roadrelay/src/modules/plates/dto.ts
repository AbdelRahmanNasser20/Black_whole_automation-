import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class LookupPlateDto {
  @Transform(upper)
  @IsString()
  @Length(1, 12)
  plate!: string;

  @Transform(upper)
  @Matches(/^[A-Z]{2}$/)
  state!: string;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  geoRegion?: string;
}
