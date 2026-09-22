import { Type } from 'class-transformer';
import {
  IsDefined,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';

export class JulsWorkspaceDto {
  @IsString()
  @Length(1, 128)
  @Matches(/^[A-Za-z0-9_-]+$/)
  externalWorkspaceId: string;
}

class JulsOwnerDto {
  @IsString()
  @Length(1, 128)
  @Matches(/^[A-Za-z0-9_-]+$/)
  externalUserId: string;

  @IsString()
  @Length(1, 200)
  @Matches(/\S/)
  name: string;
}

class JulsOrganizationDto {
  @IsString()
  @Length(1, 200)
  @Matches(/\S/)
  name: string;
}

export class JulsProvisionDto extends JulsWorkspaceDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => JulsOwnerDto)
  owner: JulsOwnerDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => JulsOrganizationDto)
  organization: JulsOrganizationDto;
}

export class JulsHandoffDto extends JulsWorkspaceDto {
  @IsString()
  @Length(1, 128)
  @Matches(/^[A-Za-z0-9_-]+$/)
  actorExternalUserId: string;
}

export class JulsMaxChannelDto extends JulsHandoffDto {
  @IsString()
  @Matches(/^-?[1-9][0-9]{0,15}$/)
  channelId: string;

  // Juls obtains this identity from the one-time code sent to the MAX bot.
  // Postiz independently checks that this user is an administrator of channelId.
  @IsString()
  @Matches(/^[1-9][0-9]{0,15}$/)
  maxUserId: string;
}
