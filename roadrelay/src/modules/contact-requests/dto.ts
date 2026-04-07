import { IsEnum, IsString, IsUUID, Length } from 'class-validator';

export const ALLOWED_INTENTS = [
  'lights_on',
  'tire_flat',
  'blocked_in',
  'left_item',
  'kind_note',
  'incident',
  'other',
] as const;

export type ContactIntent = (typeof ALLOWED_INTENTS)[number];

export class CreateContactRequestDto {
  @IsUUID('4')
  vehicleId!: string;

  @IsEnum(ALLOWED_INTENTS)
  intent!: ContactIntent;

  @IsString()
  @Length(1, 280)
  message!: string;
}
