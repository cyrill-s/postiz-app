'use client';
import { TelegramSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/telegram.dto';

import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';

function TelegramNotice() {
  return (
    <p className="text-[14px]">
      Для комментариев привяжите группу обсуждений к каналу и добавьте в неё
      бота администратором. Комментарии публикуются в ветке исходного поста. До
      4096 символов без файлов или 1024 символов с файлами; до 10 файлов.
    </p>
  );
}

export default withProvider({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: TelegramNotice,
  CustomPreviewComponent: undefined,
  dto: TelegramSettingsDto,
  maximumCharacters: 4096,
});
