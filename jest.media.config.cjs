module.exports = {
  ...require('./jest.ok-community.config.cjs'),
  testMatch: [
    '<rootDir>/libraries/nestjs-libraries/src/integrations/social/facebook.provider.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/upload/s3.object-key.spec.ts',
  ],
};
