# kie-sdk и Vercel AI SDK: решение для Postiz и aibot

Проверено 21 сентября 2026. Это анализ, не реализация миграции. Платные запросы провайдерам не запускались.

## Вывод

Сохранить kie-sdk как независимый клиент Kie. Для общего LLM-интерфейса использовать Vercel AI SDK после проверки адаптера Kie на реально нужных моделях. Для длительных медиаопераций выделить небольшой общий контракт submit/observe и правила перехода к следующему провайдеру. Сохранение состояния, конкурентный доступ, кредиты и workflow остаются в приложениях.

Не стоит ни переписывать весь kie-sdk, ни рассчитывать, что установка `ai` даст готовый безопасный Kie → OpenRouter fallback. Экономия Vercel прежде всего в сообщениях, инструментах, structured output и обработке потоков. Особенности Kie и восстановление оплаченных заданий останутся отдельной работой.

## Что именно проверено

- Основной объект: `packages/kie-sdk` в `cyrill-s/aibot`, версия пакета 1.0.0, checkout `e6c75ae`; пакет без локальных изменений.
- Есть отдельный checkout `cyrill-s/kie-sdk`: отличаются `resources/ai.ts` и `generated/chat-models.ts`. Перед разработкой нужен один источник изменений, иначе исправления продолжат расходиться.
- `pnpm test`: 7 файлов, 31 тест прошли. `pnpm typecheck`: прошёл.
- Дополнительно выполнены локальные поведенческие пробы исходников через TypeScript transpile в памяти; для timeout использован локальный HTTP-сервер. SDK и его generated-файлы не перезаписывались.
- Vercel: опубликованные `ai@7.0.107`, `@ai-sdk/provider@4.0.17`, `@openrouter/ai-sdk-provider@3.1.0`; подробные первичные источники и ограничения в [приложении](vercel-ai-sdk-findings.md).

## Что в kie-sdk уже ценно

Пакет не требует Postiz, Temporal или базы данных, не имеет runtime dependencies в package.json. Есть внедрение fetch, API-ошибки, AbortSignal, HTTP timeout, ограниченные повторы, низкоуровневые ресурсы chat/responses/Claude/Gemini, images/video/audio/music, task utilities и webhook utilities. Это уже самостоятельный клиент, а не заготовка.

`retryPolicy: safe` по умолчанию повторяет только GET. Это полезное свойство: неоднозначный результат платного POST не превращается автоматически в новую генерацию. `market.createTask` и `market.getTask` разделены, поэтому вызывающее приложение может сохранить taskId и продолжить наблюдение после рестарта. `waitForTask` — удобство для одного процесса, а не механизм долговечного выполнения.

Источники: [client.ts](https://github.com/cyrill-s/aibot/blob/e6c75ae5b792b71db9549c5086678379fd9d9a9d/packages/kie-sdk/src/client.ts#L34), [market.ts](https://github.com/cyrill-s/aibot/blob/e6c75ae5b792b71db9549c5086678379fd9d9a9d/packages/kie-sdk/src/resources/market.ts#L19), [package.json](https://github.com/cyrill-s/aibot/blob/e6c75ae5b792b71db9549c5086678379fd9d9a9d/packages/kie-sdk/package.json).

## Подтверждённые недостатки

| Проблема | Доказательство и последствия | Приоритет |
|---|---|---|
| Ошибка SSE не становится ошибкой текстовой генерации | Поток `event: error` с `data: {"error":{"message":"upstream failed"}}` возвращает `text() === ""`. После текстовых дельт аналогичная ошибка может оставить частичный текст без исключения. Сырые events доступны, но text helpers игнорируют ошибку. | Высокий |
| Встроенный timeout заканчивается на HTTP-заголовках | При timeout 25 мс сервер немедленно отдал заголовки и задержал JSON на 150 мс; SDK успешно вернул результат примерно через 160 мс. Внешний AbortSignal может компенсировать это. | Высокий |
| Некорректный JSON при HTTP 200 считается успешным | Ответ `{bad` с JSON content-type дал `undefined`, поскольку parseResponse подавляет ошибку response.json(). Приложение получает ошибку позже либо неверно считает запрос успешным. | Высокий |
| Обобщение LLM теряет семантику | Native Gemini получает system как обычное user message, image URL — как текст, а не image part. Responses получает общий `max_tokens`; правильность каждого семейства нужно сверять отдельно. Raw family API и extraBody позволяют обходы, но не делают общий интерфейс полноценным. | Высокий для мультимодальности и tools |
| Генератор может молча удалить модели | Dry inspection 35 ссылок из текущего llms.txt: 34 вернули HTML HTTP 200 без YAML, одна — пригодную native Gemini schema. Отсутствие YAML пропускается без warning; main затем записывает уменьшенный каталог. | Высокий |
| Удобный create ослабляет типизацию | Общие `images.create`/`video.create` используют `Partial<GeneratedMarketInput<...>>`; обязательные поля перестают быть обязательными. Нормализация проверяет model/plain object, но не полную схему входа. | Средний |
| wait:true затрудняет сохранение принятой операции | taskId возвращается после ожидания. При исключении из polling, особенно сетевом, структурированный handle не гарантирован. KieTaskFailedError имеет taskId, общий timeout — только сообщение. | Высокий для worker |

Источники: [streaming.ts](https://github.com/cyrill-s/aibot/blob/e6c75ae5b792b71db9549c5086678379fd9d9a9d/packages/kie-sdk/src/core/streaming.ts#L32), [ai.ts](https://github.com/cyrill-s/aibot/blob/e6c75ae5b792b71db9549c5086678379fd9d9a9d/packages/kie-sdk/src/resources/ai.ts#L58), [client timeout](https://github.com/cyrill-s/aibot/blob/e6c75ae5b792b71db9549c5086678379fd9d9a9d/packages/kie-sdk/src/client.ts#L131), [JSON parsing](https://github.com/cyrill-s/aibot/blob/e6c75ae5b792b71db9549c5086678379fd9d9a9d/packages/kie-sdk/src/client.ts#L201), [Gemini mapping](https://github.com/cyrill-s/aibot/blob/e6c75ae5b792b71db9549c5086678379fd9d9a9d/packages/kie-sdk/src/resources/ai.ts#L233), [generator](https://github.com/cyrill-s/aibot/blob/e6c75ae5b792b71db9549c5086678379fd9d9a9d/packages/kie-sdk/scripts/generate-chat-types.mjs#L24), [create types and waiting](https://github.com/cyrill-s/aibot/blob/e6c75ae5b792b71db9549c5086678379fd9d9a9d/packages/kie-sdk/src/resources/market-create.ts#L52).

Уточнение к прерванной сессии: полный нулевой каталог сегодня не воспроизведён. В текущей проверке остаётся одна native Gemini модель; chat-completion/Responses/Claude исчезли бы. Существующий каталог не перезаписан. Внешние источники: [Kie index](https://docs.kie.ai/llms.txt), [GPT 5.4 md](https://docs.kie.ai/market/chat/gpt-5-4.md), [Gemini md](https://docs.kie.ai/market/gemini/gemini-3-flash-v1beta.md). Это результат ответа сервера в момент проверки, а не доказательство удаления моделей из API.

## Что показывает использование в aibot

`KieImageProvider` уже имеет submit/observe, возвращает accepted и externalTaskId, использует внешний deadline. Для GPT Image 2, Image 1.5 и Nano Banana 2 Lite есть прямой fetch в обход SDK из-за различий текущих схем. Это конкретный сигнал, что сначала нужно исправить покрытие используемых операций, а не увеличивать число обёрток.

`textModelFallback` уже реализует цепочку моделей и запускает следующую через 30 секунд при ещё работающем запросе; это hedge с потенциальными параллельными расходами. Его нельзя автоматически переносить на изображения/видео. В `KieLyricsProvider` есть ещё отдельная последовательная цепочка. Общая библиотека может убрать повторение механики, но различия политики приложений следует сохранить.

Источники: [image provider](https://github.com/cyrill-s/aibot/blob/e6c75ae5b792b71db9549c5086678379fd9d9a9d/src/creation/kie-image-provider.ts#L114), [прямой fetch](https://github.com/cyrill-s/aibot/blob/e6c75ae5b792b71db9549c5086678379fd9d9a9d/src/creation/kie-image-provider.ts#L221), [text fallback](https://github.com/cyrill-s/aibot/blob/e6c75ae5b792b71db9549c5086678379fd9d9a9d/src/creation/text-model-fallback.ts#L22), [lyrics provider](https://github.com/cyrill-s/aibot/blob/e6c75ae5b792b71db9549c5086678379fd9d9a9d/src/creation/kie-lyrics-provider.ts#L129).

В Postiz текущий путь изображения: MediaService → useCredit → OpenaiService → openai.images.generate, результат base64. Подмена на Kie должна учитывать асинхронный accepted/taskId, получение URL и формат результата, а также момент списания/компенсации кредита. Простая замена одной функции не покрывает эти изменения. Источники: [media.service.ts](../../libraries/nestjs-libraries/src/database/prisma/media/media.service.ts), [openai.service.ts](../../libraries/nestjs-libraries/src/openai/openai.service.ts).

## Сравнение

| Возможность | kie-sdk | Vercel AI SDK |
|---|---|---|
| Специфические Kie endpoints и taskId | Уже реализованы, требуют исправлений и актуализации | Нужен адаптер; универсальный API сам по себе не знает Kie |
| LLM messages/tools/structured output | Есть raw family API, нормализация ограничена | Основная ценность: общие контракты и orchestration tools |
| Потоки | SSE parser + text extraction с пробелами обработки ошибок | Общий типизированный поток; корректность Kie mapping всё равно надо проверить |
| Генерация изображений | submit/get доступны | ImageModelV4 имеет doGenerate, отдельного стандартного start/status нет |
| Долгое видео | Раздельные submit/get, waiting в памяти | Есть experimental_startVideo/getVideoStatus; поддержка зависит от адаптера |
| OpenRouter video | Нет адаптера | Версия 3.1.0 имеет doGenerate, но не doStart/doStatus |
| Runtime fallback | Правила находятся в приложении | customProvider.fallbackProvider — lookup, не переключение после ошибки; Gateway — отдельный сервис |
| Восстановление приложения | Приложение хранит taskId | Приложение также хранит operation; это не замена БД/Temporal |

Первичные источники для правой колонки и точные пути опубликованного кода: [приложение Vercel](vercel-ai-sdk-findings.md).

Дополнительный риск в проверенных версиях: OpenRouter video adapter помечает timeout внутреннего polling как retryable, а generateVideo повторяет весь doGenerate, включая submit. С двумя повторами по умолчанию возможны три POST на одну логическую генерацию. Это вывод из кода, не воспроизведённое списание; дедупликация сервера не проверялась. Для такого адаптера нужен `maxRetries: 0` до безопасного разделения submit/status. ImageModelV4 также ожидает binary/base64, поэтому Kie URL потребует скачивания внутри convenience adapter либо отдельного контракта результата.

## Предлагаемая граница общего пакета

Postiz и aibot подключают небольшой ai-generation пакет. Он содержит контракты входа/выхода, явно выбранные маршруты, проверку совместимости, классификацию ошибок и чистую логику выбора следующей попытки. Внутри: Vercel AI SDK для LLM; Kie adapter поверх kie-sdk; OpenRouter adapter по нужной модальности.

Для media результат submit должен быть различимым: completed, accepted с сохраняемым handle, rejected или unknown. Handle: provider, model, kind/API family, taskId и необходимые сериализуемые metadata; ключи доступа туда не включать. observe(handle) возвращает pending, succeeded, failed или unknown. Последнее означает проблему наблюдения, а не подтверждённый провал генерации.

Приложения сохраняют каждую попытку, обеспечивают единственного исполнителя перехода, планируют polling, принимают и сверяют callbacks, управляют бюджетом, кредитами и доставкой. Temporal activities выполняют provider I/O; workflow оперирует идентификаторами и результатами. Общий пакет не импортирует Temporal или модели БД.

| Событие | Правило по умолчанию |
|---|---|
| Документированный отказ до принятия | Следующий совместимый маршрут, если политика разрешает |
| Получен taskId, задача работает | Сохранить и наблюдать ту же задачу |
| Таймаут POST / оборванный ответ без taskId | unknown; без автоматического повторного платного submit |
| Ошибка GET статуса | Повторить наблюдение, не генерацию |
| Подтверждённый terminal fail | Fallback возможен по категории ошибки и бюджету |
| Пользователь отменил / вход невалиден / policy rejection | Остановить или исправить запрос, не обходить ограничение другим маршрутом |
| Уже выдана часть текста | Не склеивать поток другой модели; явно завершить попытку или начать отдельный результат |

HTTP 5xx сам по себе не доказывает, что оплаченная задача не принята. Локальная отмена также не доказывает отмену работы у провайдера. Замена модели требует проверки reference images, aspect ratio, resolution, duration, tools и structured output; совпадение маркетингового имени модели недостаточно.

## Последовательность реализации

1. Выбрать один источник kie-sdk и перенести нужные расхождения двух копий с проверкой поведения. Исправить timeout, SSE errors, malformed response и сохранить task handle при ожидании. Добавить именно регрессионные проверки этих сценариев.
2. Защитить генераторы: проверка типа содержимого, обязательные предупреждения, fixtures, запрет записи при нулевом/резко усечённом покрытии и ручной review diff. Актуализировать модели, которые aibot уже вызывает через fetch.
3. Сделать узкий Kie LLM adapter для AI SDK по используемым семействам: полные message parts, ошибки, finish reason, usage. Не строить его на текущем lossy generateText helper. Начать с проверенного подмножества text и structured output, tools подключать с контрактными тестами.
4. Сделать общий submit/observe и управляемый fallback для изображения. В Postiz адаптировать результат под нынешних потребителей и отделить пользовательский кредит от отдельных provider attempts.
5. Прогнать карусель: текст → Kie image → контролируемый terminal fail → OpenRouter image; отдельно — restart после accepted, неизвестный submit, сбой polling, два конкурентных workers и поздний callback от предыдущей попытки.

Критерий готовности: после рестарта продолжается наблюдение прежнего taskId, unknown не создаёт вторую платную попытку автоматически, terminal fail переключается ровно один раз, а результат удовлетворяет тем же требованиям к изображению. Реальную доступность выбранной пары моделей, стоимость и поведение при сбоях подтвердить отдельным контролируемым live smoke test; этот аудит их не проверял.
