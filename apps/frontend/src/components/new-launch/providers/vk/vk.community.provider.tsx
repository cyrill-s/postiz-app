'use client';

import { PostComment, withProvider } from '../high.order.provider';

function CommunityNotice() {
  return (
    <p className="text-[14px]">
      Ключ сообщества VK: публикуйте текст и ссылки. Загрузка фото и видео
      недоступна. Уже опубликованные записи удаляются в самом VK.
    </p>
  );
}

export default withProvider({
  postComment: PostComment.POST,
  comments: false,
  minimumCharacters: [],
  SettingsComponent: CommunityNotice,
  maximumCharacters: 2048,
});
