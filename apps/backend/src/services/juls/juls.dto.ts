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
