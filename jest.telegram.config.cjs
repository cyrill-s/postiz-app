module.exports = {
  ...require('./jest.ok-community.config.cjs'),
  testMatch: [
    '<rootDir>/libraries/nestjs-libraries/src/integrations/social/telegram*.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/database/prisma/integrations/telegram.analytics.spec.ts',
    '<rootDir>/libraries/helpers/src/utils/social-formatting.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/dtos/posts/create.community.post.spec.ts',
  ],
};
