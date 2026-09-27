import {
  AuthTokenDetails,
  AnalyticsData,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import dayjs from 'dayjs';
import { SocialAbstract } from '@gitroom/nestjs-libraries/integrations/social.abstract';
//@ts-ignore
import mime from 'mime';
import TelegramBot from 'node-telegram-bot-api';
import { Integration } from '@prisma/client';
import { compileSocialContent } from '@gitroom/helpers/utils/social-formatting';
import { BadBody } from '../social.abstract';
import { TelegramSettingsDto } from '../../dtos/posts/providers-settings/telegram.dto';
import { TelegramUpdates } from './telegram.updates';
import { timer } from '@gitroom/helpers/utils/timer';

const telegramBot = new TelegramBot(process.env.TELEGRAM_TOKEN!);
// Added to support local storage posting
const frontendURL = process.env.FRONTEND_URL || 'http://localhost:5000';
const mediaStorage = process.env.STORAGE_PROVIDER || 'local';

export class TelegramProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 3; // Telegram has moderate bot API limits
  identifier = 'telegram';
  name = 'Telegram';
  isBetweenSteps = false;
  isWeb3 = true;
  scopes = [] as string[];
  editor = 'html' as const;
  dto = TelegramSettingsDto;
  analyticsPublishedPosts = true;
  private updates = new TelegramUpdates();
  maxLength() {
    return 4096;
  }

  override async checkValidity(posts: Array<Array<{ path: string }>>) {
    return posts.slice(1).some((media) => media.length > 10)
      ? 'Telegram: не более 10 файлов в одном комментарии.'
      : (true as const);
  }

  async refreshToken(refresh_token: string): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }

  async generateAuthUrl() {
    const state = makeId(17);
    return {
      url: state,
      codeVerifier: makeId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const chat = await telegramBot.getChat(params.code);

    if (!chat?.id) {
      return 'No chat found';
    }

    const photo = !chat?.photo?.big_file_id
      ? ''
      : await telegramBot.getFileLink(chat.photo.big_file_id);

    // Modified id to work with chat.username (public groups/channels) or chat.id (private groups/channels) when chat.username is not available
    return {
      id: String(chat.username ? chat.username : chat.id),
      name: chat.title!,
      accessToken: String(chat.id),
      refreshToken: '',
      expiresIn: dayjs().add(200, 'year').unix() - dayjs().unix(),
      picture: photo || '',
      username: chat.username!,
    };
  }

  async getBotId(query: { id?: number; word: string }) {
    // A webhook and getUpdates cannot run together. Keep the existing onboarding
    // flow, reading its short-lived command receipt when webhook mode is enabled.
    const connected = this.updates.enabled()
      ? await this.updates.connection(query.word)
      : null;
    const res = this.updates.enabled()
      ? []
      : await telegramBot.getUpdates({
          ...(query.id ? { offset: query.id } : {}),
          allowed_updates: ['message', 'channel_post'],
        });
    //message.text is for groups, channel_post.text is for channels
    const match = res.find(
      (p) =>
        (p?.message?.text === `/connect ${query.word}` &&
          p?.message?.chat?.id) ||
        (p?.channel_post?.text === `/connect ${query.word}` &&
          p?.channel_post?.chat?.id)
    );
    // get correct chatId based on the channel type
    const chatId =
      connected?.chatId ||
      match?.message?.chat?.id ||
      match?.channel_post?.chat?.id;

    // prevents the code from running while chatId is still undefined to avoid the error 'ETELEGRAM: 400 Bad Request: chat_id is empty'. the code would still work eventually but console spam is not pretty
    if (chatId) {
      //get the numberic ID of the bot
      const botId = (await telegramBot.getMe()).id;
      // check if the bot is an admin in the chat
      const isAdmin = await this.botIsAdmin(chatId, botId);
      // get the messageId of the message that triggered the connection
      const connectMessageId =
        connected?.messageId ||
        match?.message?.message_id ||
        match?.channel_post?.message_id;

      if (!isAdmin) {
        // alternatively you can replace this with a console.log if you do not want to inform the user of the bot's admin status
        telegramBot.sendMessage(
          chatId,
          "Connection Successful. I don't have admin privileges to delete these messages, please go ahead and remove them yourself."
        );
      } else {
        // Delete the message that triggered the connection
        await telegramBot.deleteMessage(chatId, connectMessageId);
        // Send success message to the chat
        const successMessage = await telegramBot.sendMessage(
          chatId,
          'Connection Successful. Message will be deleted in 10 seconds.'
        );
        // Delete the success message after 10 seconds
        setTimeout(async () => {
          await telegramBot.deleteMessage(chatId, successMessage.message_id);
          console.log('Success message deleted.');
        }, 10000);
      }
    }

    // modified lastChatId to work with any type of channel (private/public groups/channels)
    return chatId
      ? { chatId }
      : res.length > 0
      ? {
          lastChatId: res[res.length - 1].update_id + 1,
        }
      : {};
  }

  private processMedia(mediaFiles: PostDetails['media']) {
    return (mediaFiles || []).map((media) => {
      let mediaUrl = media.path;
      if (mediaStorage === 'local' && mediaUrl.startsWith(frontendURL)) {
        mediaUrl = mediaUrl.replace(frontendURL, '');
      }
      //get mime type to pass contentType to telegram api.
      //some photos and videos might not pass telegram api restrictions, so they are sent as documents instead of returning errors
      const mimeType = mime.getType(mediaUrl); // Detect MIME type
      let mediaType: 'photo' | 'video' | 'document';

      if (mimeType?.startsWith('image/')) {
        mediaType = 'photo';
      } else if (mimeType?.startsWith('video/')) {
        mediaType = 'video';
      } else {
        mediaType = 'document';
      }

      return {
        type: mediaType,
        media: mediaUrl,
        fileOptions: {
          filename: media.path.split('/').pop(),
          contentType: mimeType || 'application/octet-stream',
        },
      };
    });
  }

  private async sendMessage(
    accessToken: string,
    message: PostDetails,
    replyToMessageId?: number
  ): Promise<number | null> {
    let messageId: number | null = null;
    const mediaFiles = message.media || [];
    const compiled = compileSocialContent(
      'telegram',
      message.sourceHtml ?? message.message ?? ''
    );
    const text = compiled.message;
    const limit = mediaFiles.length ? 1024 : 4096;
    if (compiled.length > limit)
      throw new BadBody(
        this.identifier,
        '{}',
        '{}',
        `Telegram text exceeds ${limit} characters.`
      );
    const processedMedia = this.processMedia(mediaFiles);

    // if there's no media, bot sends a text message only
    if (processedMedia.length === 0) {
      const response = await telegramBot.sendMessage(accessToken, text, {
        parse_mode: 'HTML',
        ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
      });
      messageId = response.message_id;
    }
    // if there's only one media, bot sends the media with the text message as caption
    else if (processedMedia.length === 1) {
      const media = processedMedia[0];
      const options = {
        caption: text,
        parse_mode: 'HTML' as const,
        ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
      };
      const response =
        media.type === 'video'
          ? await telegramBot.sendVideo(
              accessToken,
              media.media,
              options,
              media.fileOptions
            )
          : media.type === 'photo'
          ? await telegramBot.sendPhoto(
              accessToken,
              media.media,
              options,
              media.fileOptions
            )
          : await telegramBot.sendDocument(
              accessToken,
              media.media,
              options,
              media.fileOptions
            );
      messageId = response.message_id;
    }
    // if there are multiple media, bot sends them as a media group - max 10 media per group - with the text as a caption (if there are more than 1 group, the caption will only be sent with the first group)
    else {
      const mediaGroups = this.chunkMedia(processedMedia, 10);
      for (let i = 0; i < mediaGroups.length; i++) {
        const mediaGroup = mediaGroups[i].map((m, index) => ({
          type: m.type === 'document' ? 'document' : m.type, // Documents are not allowed in media groups
          media: m.media,
          caption: i === 0 && index === 0 ? text : undefined,
          parse_mode: 'HTML',
        }));

        const response = await telegramBot.sendMediaGroup(
          accessToken,
          mediaGroup as any[],
          {
            ...(replyToMessageId && i === 0
              ? { reply_to_message_id: replyToMessageId }
              : {}),
          }
        );
        if (i === 0) {
          messageId = response[0].message_id;
        }
      }
    }

    return messageId;
  }

  private async deliver(
    accessToken: string,
    post: PostDetails,
    replyToId?: number
  ): Promise<number | null> {
    const checkpoint = await post.telegramDelivery?.load();
    if (checkpoint?.chatId && checkpoint.chatId !== accessToken)
      throw new BadBody(
        this.identifier,
        '{}',
        '{}',
        'The Telegram destination changed. Create a new post.'
      );
    const separate =
      post.settings?.separateText === true &&
      !!post.media?.length &&
      !!compileSocialContent('telegram', post.sourceHtml ?? post.message).text;
    if (!separate && !checkpoint)
      return this.sendMessage(accessToken, post, replyToId);
    if (!post.telegramDelivery)
      throw new BadBody(
        this.identifier,
        '{}',
        '{}',
        'Telegram split delivery requires persistent progress.'
      );
    const compiled = compileSocialContent(
      'telegram',
      post.sourceHtml ?? post.message
    );
    if (compiled.length > 4096)
      throw new BadBody(
        this.identifier,
        '{}',
        '{}',
        'Telegram text exceeds 4096 characters. Shorten the text.'
      );
    if (checkpoint?.phase === 'completed') return checkpoint.textMessageId!;
    if (
      checkpoint?.phase === 'sending-media' ||
      checkpoint?.phase === 'sending-text'
    ) {
      throw new BadBody(
        this.identifier,
        '{}',
        '{}',
        'Telegram delivery could not be confirmed. Check the channel before retrying.'
      );
    }
    let mediaMessageId = checkpoint?.mediaMessageId;
    if (!mediaMessageId) {
      await post.telegramDelivery.save({
        chatId: accessToken,
        phase: 'sending-media',
      });
      try {
        mediaMessageId = (await this.sendMessage(
          accessToken,
          { ...post, message: '', sourceHtml: '' },
          replyToId
        ))!;
      } catch (error) {
        // Only an explicit API rejection proves the operation did not publish.
        // Unknown outcomes stay checkpointed and must not duplicate media.
        throw new BadBody(
          this.identifier,
          '{}',
          '{}',
          'Telegram media delivery could not be confirmed. Check the channel.'
        );
      }
      await post.telegramDelivery.save({
        chatId: accessToken,
        phase: 'media-sent',
        mediaMessageId,
      });
    }
    await post.telegramDelivery.save({
      chatId: accessToken,
      phase: 'sending-text',
      mediaMessageId,
    });
    let textMessageId: number;
    try {
      textMessageId = (await this.sendMessage(accessToken, {
        ...post,
        media: [],
      }))!;
    } catch (error) {
      const rejected =
        (error as { response?: { body?: { ok?: boolean } } })?.response?.body
          ?.ok === false;
      if (rejected)
        await post.telegramDelivery.save({
          chatId: accessToken,
          phase: 'media-sent',
          mediaMessageId,
        });
      throw new BadBody(
        this.identifier,
        '{}',
        '{}',
        rejected
          ? 'Published partially: media was sent. Retry only the text.'
          : 'Published partially: media was sent; text delivery is unconfirmed. Check the channel.'
      );
    }
    await post.telegramDelivery.save({
      chatId: accessToken,
      phase: 'completed',
      mediaMessageId,
      textMessageId,
    });
    return textMessageId;
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[]
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;

    const messageId = await this.deliver(accessToken, firstPost);

    // for private groups/channels message.id is undefined so the link generated by Postiz will be unusable "https://t.me/c/undefined/16"
    // to avoid that, we use accessToken instead of message.id and we generate the link manually removing the -100 from the start.
    if (messageId) {
      return [
        {
          id: firstPost.id,
          postId: String(messageId),
          releaseURL: this.messageUrl(id, accessToken, messageId),
          status: 'completed',
        },
      ];
    }

    return [];
  }

  async comment(
    id: string,
    postId: string,
    _lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [commentPost] = postDetails;
    if (
      postDetails.length !== 1 ||
      !/^[1-9][0-9]*$/.test(postId) ||
      !Number.isSafeInteger(Number(postId))
    )
      this.fail('Некорректная публикация Telegram для комментария.');
    const destination = await this.commentDestination(accessToken);
    let replyToId = Number(postId);
    let targetChat = accessToken;
    if (destination.type === 'channel') {
      let discussion = await this.updates.discussion(accessToken, postId);
      // The automatic forward may reach the webhook just after sendMessage returns.
      for (let attempt = 0; !discussion && attempt < 15; attempt++) {
        await timer(1000);
        discussion = await this.updates.discussion(accessToken, postId);
      }
      if (!discussion || discussion.chatId !== destination.linked_chat_id) {
        this.fail(
          'Не найдена ветка обсуждения поста Telegram. Проверьте группу обсуждений и доступ бота; пост уже опубликован.'
        );
      }
      targetChat = String(discussion.chatId);
      replyToId = discussion.messageId;
    }
    // Comments always reply to the original discussion root. A missing root must
    // fail instead of becoming an unrelated message in the group or channel.
    let messageId: number | null;
    try {
      messageId = await this.deliver(
        targetChat,
        {
          ...commentPost,
          settings: { ...commentPost.settings, separateText: false },
        },
        replyToId
      );
    } catch (error) {
      if (error instanceof BadBody) throw error;
      this.fail(
        'Telegram не подтвердил комментарий. Проверьте ветку обсуждения перед повторной отправкой.'
      );
    }

    if (messageId) {
      return [
        {
          id: commentPost.id,
          postId: String(messageId),
          releaseURL:
            destination.type === 'channel'
              ? `${this.messageUrl(
                  destination.username || id,
                  accessToken,
                  Number(postId)
                )}?comment=${messageId}`
              : this.messageUrl(
                  destination.username || id,
                  accessToken,
                  messageId
                ),
          status: 'completed',
        },
      ];
    }

    return [];
  }

  private fail(message: string): never {
    throw new BadBody(this.identifier, '{}', '{}', message);
  }

  private messageUrl(id: string, chatId: string, messageId: number) {
    if (/^[a-zA-Z][a-zA-Z0-9_]{3,31}$/.test(id) && id !== 'undefined')
      return `https://t.me/${id}/${messageId}`;
    return /^-100[0-9]+$/.test(chatId)
      ? `https://t.me/c/${chatId.slice(4)}/${messageId}`
      : '';
  }

  private async commentDestination(accessToken: string) {
    if (
      !/^-?[1-9][0-9]*$/.test(accessToken) ||
      !Number.isSafeInteger(Number(accessToken))
    )
      this.fail('Переподключите канал Telegram.');
    try {
      const chat = await telegramBot.getChat(accessToken);
      if (String(chat.id) !== accessToken)
        this.fail('Канал Telegram не соответствует подключению.');
      if (chat.type !== 'channel') return chat;
      if (!chat.linked_chat_id)
        this.fail(
          'Привяжите группу обсуждений к каналу Telegram и добавьте в неё бота администратором.'
        );
      if (!this.updates.enabled())
        this.fail(
          'Приём комментариев Telegram не настроен. Обратитесь к администратору Postiz.'
        );
      const [group, me] = await Promise.all([
        telegramBot.getChat(chat.linked_chat_id),
        telegramBot.getMe(),
      ]);
      if (group.type !== 'supergroup' || group.linked_chat_id !== chat.id)
        this.fail('Группа обсуждений Telegram не связана с этим каналом.');
      const member = await telegramBot.getChatMember(group.id, me.id);
      if (!['administrator', 'creator'].includes(member.status))
        this.fail(
          'Добавьте бота администратором в группу обсуждений Telegram.'
        );
      return chat;
    } catch (error) {
      if (error instanceof BadBody) throw error;
      this.fail(
        'Не удалось проверить обсуждения Telegram. Проверьте доступ бота к каналу и группе обсуждений.'
      );
    }
  }

  async checkCommentSupport(
    _id: string,
    accessToken: string
  ): Promise<true | string> {
    try {
      await this.commentDestination(accessToken);
      return true;
    } catch (error) {
      return error instanceof BadBody
        ? error.message
        : 'Не удалось проверить комментарии Telegram.';
    }
  }

  async analytics(
    _id: string,
    accessToken: string,
    _date: number
  ): Promise<AnalyticsData[]> {
    try {
      const total = await telegramBot.getChatMemberCount(accessToken);
      if (!Number.isSafeInteger(total) || total < 0) return [];
      return [
        {
          label: 'Подписчики',
          type: 'snapshot',
          percentageChange: 0,
          description:
            'Текущее число участников. Telegram Bot API не предоставляет просмотры и историю охвата.',
          data: [{ total: String(total), date: dayjs().format('YYYY-MM-DD') }],
        },
      ];
    } catch {
      this.fail(
        'Не удалось получить статистику Telegram. Проверьте доступ бота к каналу.'
      );
    }
  }
  // chunkMedia is used to split media into groups of "size". 10 is used here because telegram api allows a maximum of 10 media per group
  private chunkMedia(media: { type: string; media: string }[], size: number) {
    const result = [];
    for (let i = 0; i < media.length; i += size) {
      result.push(media.slice(i, i + size));
    }
    return result;
  }

  async botIsAdmin(chatId: number, botId: number): Promise<boolean> {
    try {
      const chatMember = await telegramBot.getChatMember(chatId, botId);

      if (
        chatMember.status === 'administrator' ||
        chatMember.status === 'creator'
      ) {
        const permissions = chatMember.can_delete_messages;
        return !!permissions; // Return true if bot can delete messages
      }

      return false;
    } catch (error) {
      console.error('Error checking bot privileges:', error);
      return false;
    }
  }
}
