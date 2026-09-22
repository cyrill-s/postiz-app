module.exports = {
  ...require('./jest.vk-community.config.cjs'),
  testMatch: [
    '<rootDir>/libraries/nestjs-libraries/src/integrations/social/threads.provider.spec.ts',
  ],
};
