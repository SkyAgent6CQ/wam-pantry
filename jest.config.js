'use strict';

/** Unit + integration test projects with a coverage gate (build fails below threshold). */
module.exports = {
  projects: [
    { displayName: 'unit', testEnvironment: 'node', testMatch: ['<rootDir>/tests/unit/**/*.test.js'] },
    { displayName: 'integration', testEnvironment: 'node', testMatch: ['<rootDir>/tests/integration/**/*.test.js'] },
  ],
  collectCoverageFrom: ['src/**/*.js', '!src/server.js'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'lcov', 'cobertura'],
  coverageThreshold: {
    global: { statements: 85, branches: 75, functions: 85, lines: 85 },
  },
  reporters: [
    'default',
    ['jest-junit', { outputDirectory: 'reports', outputName: 'junit.xml', suiteNameTemplate: '{displayName} › {filepath}', classNameTemplate: '{displayName} › {classname}', addFileAttribute: 'true' }],
  ],
};
