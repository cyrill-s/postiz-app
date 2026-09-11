# Telegram-first post formatting

## Agreed scope

Extend the existing toolbar below the editor (signature, bold, underline, emoji). Support bold, italic, underline, strike, spoiler, bullet and ordered lists, inline code, code blocks, ordinary quotes, expandable quotes and links. No code-language picker. Preserve rich HTML in the shared post and existing per-channel overrides.

Initial destinations: Telegram, MAX, OK, VK (profile and community), Threads, YouTube video descriptions. Each destination receives its native supported formatting; unsupported formatting is removed, preserving the text, including openly publishing unsupported spoilers. Do not simulate styling with Unicode letters. Plain links retain `label (URL)` without duplicate URLs. Lists retain `•` or numbered markers. Plain quotes use `>`, except YouTube uses `«…»`. Code preserves line breaks and indentation.

Preview the compiled destination result, with clickable/keyboard-accessible spoilers and expandable quotes. Telegram and MAX use supported HTML, Threads uses spoiler entities. Other initial destinations receive plain text. The source editor keeps the complete formatting regardless of which destination is selected.

For an oversized Telegram media caption, show the limit and offer explicit opt-in to two messages: media first, entire text second. Preview both. This applies to the main post; existing follow-up comments keep their caption limit. Text exceeding 4096 must be shortened. Other destinations do not split automatically.

If media succeeds but Telegram rejects the text, show “Published partially” with “Retry text only”. Persist delivery progress in the post record and reuse it across retries. Do not resend media. An unknown API outcome must not trigger an automatic duplicate. Recurring occurrences must still publish after a completed previous occurrence.

## Implementation and deployment

`compileSocialContent` is the shared conversion boundary for API payloads, validation and preview. The input sanitizer preserves the supported source marks. Platform adapters receive only compiled messages plus the metadata they need.

Telegram split delivery stores progress in `Post.telegramDelivery`. Apply the additive migration `20260911120000_telegram_delivery` (or the deployment's usual Prisma schema synchronization) before running the new backend. No production database was changed during implementation.

Delivery phases record the send attempt before the external request, then the confirmed message ID. A confirmed text rejection leaves `media-sent`, allowing the dedicated retry action. Lost responses leave `sending-media`/`sending-text`; the UI asks the author to inspect the channel. The normal calendar error state is retained for compatibility; the partial-publication label is derived from the checkpoint. The API retry claims an errored post atomically and uses the normal publishing workflow.

## API contracts

- [Telegram Bot API](https://core.telegram.org/bots/api#formatting-options): supported HTML; 4096 text / 1024 caption after entity parsing. Lists are literal markers.
- [MAX API](https://dev.max.ru/docs-api): `format: html` supports the standard styles, links, code and ordinary quotes; spoilers fall back to visible text.
- [Meta's Threads API collection](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api): `text_entities` supports spoilers in the main post. Separate text attachments are outside this feature.
- [OK media topics](https://apiok.ru/dev/methods/rest/mediatopic/mediatopic.post) and [VK wall schema](https://github.com/VKCOM/vk-api-schema/blob/master/wall/methods.json): the current posting surfaces use plain text. Existing configured length limits are retained.
- [YouTube video descriptions](https://developers.google.com/youtube/v3/docs/videos): 5000 bytes, angle brackets rejected with a visible validation error. Quotes use guillemets.

## Verification

Agreed test boundaries: social text conversion and Telegram delivery/retry. Run `pnpm exec jest --config jest.formatting.config.cjs --runInBand` for these tests. The configuration also supports running every repository spec via `--testMatch '**/*.spec.ts'` without the obsolete root Nx configuration.

Typecheck the frontend, backend and orchestrator. A temporary browser harness mounted the actual formatting toolbar, quote/spoiler extensions and destination preview to check interactions. Live channel publication is not part of local verification.

Verification result: all 83 tests across 7 suites passed; frontend, backend and orchestrator typechecks passed. Standards review identified and resolved workflow-dispatch failure recovery. Spec review identified and resolved YouTube preview indentation and byte-limit feedback. Both targeted rechecks passed.
