'use client';
import { PostComment, withProvider } from '../high.order.provider';

function MaxNotice() {
  return (
    <p className="text-[14px]">
      Включите комментарии в настройках канала и дайте боту права чтения и
      публикации. Комментарии — до 4000 символов, без фото и видео. Ссылки в
      комментариях отправляются обычным текстом.
    </p>
  );
}

export default withProvider({
  postComment: PostComment.COMMENT,
  comments: 'no-media',
  minimumCharacters: [],
  SettingsComponent: MaxNotice,
  maximumCharacters: 4000,
});
