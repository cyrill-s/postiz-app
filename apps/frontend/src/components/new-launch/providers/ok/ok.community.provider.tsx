'use client';
import { PostComment, withProvider } from '../high.order.provider';
function OkNotice() {
  return (
    <p className="text-[14px]">
      Публикация от имени группы: текст, ссылки и до 10 фото JPG/PNG по 10 МБ.
      Для фото нужно право PHOTO_CONTENT. Видео и комментарии пока не
      поддерживаются.
    </p>
  );
}
export default withProvider({
  postComment: PostComment.POST,
  comments: false,
  minimumCharacters: [],
  SettingsComponent: OkNotice,
  maximumCharacters: 10000,
});
