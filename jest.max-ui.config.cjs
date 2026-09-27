module.exports = {
  ...require('./jest.max.config.cjs'),
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/apps/frontend/src/components/platform-analytics/analytics.snapshot.spec.tsx',
  ],
  modulePathIgnorePatterns: ['<rootDir>/.local-build/'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          ...require('./tsconfig.base.json').compilerOptions,
          jsx: 'react-jsx',
          isolatedModules: true,
        },
      },
    ],
  },
  moduleNameMapper: {
    ...require('./jest.max.config.cjs').moduleNameMapper,
    '^@gitroom/frontend/(.*)$': '<rootDir>/apps/frontend/src/$1',
    '^@gitroom/react/(.*)$':
      '<rootDir>/libraries/react-shared-libraries/src/$1',
  },
};
