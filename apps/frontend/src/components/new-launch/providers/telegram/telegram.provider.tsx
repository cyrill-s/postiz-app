'use client';
import { TelegramSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/telegram.dto';

import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
export default withProvider({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: null,
  CustomPreviewComponent: undefined,
  dto: TelegramSettingsDto,
  maximumCharacters: 4096,
});
