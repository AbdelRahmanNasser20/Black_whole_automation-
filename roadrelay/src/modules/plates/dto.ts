import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class LookupPlateDto {
  @IsString()
  @Length(1, 12)
  plate!: string;

  @Matches(/^[A-Z]{2}$/)
  state!: string;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  geoRegion?: string;
}
