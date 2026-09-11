module.exports = {
  ...require('./jest.ok-community.config.cjs'),
  testMatch: [
    '<rootDir>/libraries/helpers/src/utils/social-formatting.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/integrations/social/telegram.provider.spec.ts',
  ],
};
