import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsDefined,
  IsNotEmpty,
  IsString,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { sanitizePostContent } from '@gitroom/helpers/utils/sanitize.post.content';

export class UpdatePostGroupContentDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsDefined()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? sanitizePostContent(value) : value
  )
  content: string;
}

export class UpdatePostGroupDto {
  @ValidateIf((o) => o.date !== undefined)
  @IsDateString({ strict: true })
  @Matches(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/,
    { message: 'date must be an ISO-8601 UTC timestamp' }
  )
  date?: string;

  @ValidateIf((o) => o.posts !== undefined)
  @IsArray()
  @ArrayUnique((post: UpdatePostGroupContentDto) => post?.id)
  @Type(() => UpdatePostGroupContentDto)
  @ValidateNested({ each: true })
  posts?: UpdatePostGroupContentDto[];

  @ValidateIf((o) => o.removePostIds !== undefined)
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  removePostIds?: string[];
}
