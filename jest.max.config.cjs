module.exports = {
  ...require('./jest.ok-community.config.cjs'),
  testMatch: [
    '<rootDir>/libraries/nestjs-libraries/src/integrations/social/max.provider.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/dtos/posts/create.community.post.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/temporal/temporal.module.spec.ts',
  ],
};
