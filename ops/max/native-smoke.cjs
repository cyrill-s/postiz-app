// Run in the release image with --network none and no production credentials.
const assert = require('node:assert/strict');
process.env.JWT_SECRET = 'max-native-isolated-runtime-smoke';
(async () => {
  for (const app of ['backend', 'orchestrator']) {
    const root = `/app/apps/${app}/dist`;
    const { MaxProvider } = require(`${root}/libraries/nestjs-libraries/src/integrations/social/max.provider.js`);
    const { AuthService } = require(`${root}/libraries/helpers/src/auth/auth.service.js`);
    const { compileSocialContent } = require(`${root}/libraries/helpers/src/utils/social-formatting.js`);
    require(`${root}/libraries/nestjs-libraries/src/database/prisma/posts/posts.service.js`);
    const provider = new MaxProvider();
    assert.equal(await provider.checkValidity([[], [], []]), true);
    const compiled = compileSocialContent('max', '<b>Test</b> <a href="https://example.org">link</a>', undefined, { comment: true });
    assert.equal(compiled.message, '<b>Test</b> link (https://example.org)');
    const token = AuthService.fixedEncryption(JSON.stringify({ chatId: '-123', token: 'synthetic' }));
    global.fetch = async (url, init) => {
      assert.equal(init.headers.Authorization, 'synthetic');
      if (init.method === 'POST') {
        assert.equal(url, 'https://platform-api2.max.ru/messages/mid.root/comments');
        assert.deepEqual(JSON.parse(init.body), { text: 'runtime smoke' });
        return new Response(JSON.stringify({ message: { body: { mid: 'mid.comment' } } }));
      }
      return new Response(JSON.stringify({ messages: [{ body: { mid: 'mid.root' }, recipient: { chat_id: -123, chat_type: 'channel' }, stat: { views: 42 } }] }));
    };
    const response = await provider.comment('max:-123', 'mid.root', undefined, token, [{ id: 'internal', message: 'runtime smoke', settings: {} }]);
    assert.equal(response[0].postId, 'mid.comment');
    assert.equal((await provider.postAnalytics('max:-123', token, 'mid.root', 7))[0].type, 'snapshot');
    console.log(`${app}: compiled MAX comments, analytics, formatting and posts service passed`);
  }
  process.exit(0);
})().catch(error => { console.error(error.name, error.message); process.exit(1); });
