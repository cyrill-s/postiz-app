'use client';

import { withContinueProvider } from '../with-continue-provider';

interface Community {
  id: string;
  name: string;
  picture: string;
}

export const VkCommunityContinue = withContinueProvider<Community, string>({
  endpoint: 'pages',
  swrKey: 'load-vk-communities',
  titleKey: 'select_vk_community',
  titleDefault: 'Выберите сообщество VK',
  emptyStateMessages: [
    {
      key: 'vk_communities_not_found',
      text: 'Не удалось получить список сообществ VK.',
    },
    {
      key: 'vk_communities_check_permissions',
      text: 'Проверьте права администратора или редактора сообщества и разрешения приложения VK, затем подключите канал заново.',
    },
  ],
  getItemId: (item) => item.id,
  getSelectionValue: (item) => item.id,
  transformSaveData: (page) => ({ page }),
  isSelected: (item, selection) => item.id === selection,
  renderItem: (item) => (
    <>
      <img className="w-full" src={item.picture} alt="" />
      <div>{item.name}</div>
    </>
  ),
});
