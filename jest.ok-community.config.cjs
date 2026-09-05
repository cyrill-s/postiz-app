module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/libraries/nestjs-libraries/src/integrations/social/ok.community.provider.spec.ts', '<rootDir>/libraries/nestjs-libraries/src/temporal/temporal.module.spec.ts'],
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.base.json', isolatedModules: true }] },
  moduleNameMapper: {
    '^@gitroom/nestjs-libraries/(.*)$': '<rootDir>/libraries/nestjs-libraries/src/$1',
    '^@gitroom/helpers/(.*)$': '<rootDir>/libraries/helpers/src/$1',
  },
};
