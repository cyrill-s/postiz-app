module.exports = {
  ...require('./jest.juls.config.cjs'),
  testMatch: [
    '<rootDir>/libraries/nestjs-libraries/src/database/prisma/posts/posts.group.spec.ts',
    '<rootDir>/apps/backend/src/public-api/routes/v1/public.post.group.spec.ts',
  ],
};
