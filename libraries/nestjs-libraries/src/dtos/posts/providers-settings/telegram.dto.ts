import { IsBoolean, IsOptional } from 'class-validator';

export class TelegramSettingsDto {
  @IsOptional()
  @IsBoolean()
  separateText?: boolean;
}
