'use strict';

/**
 * Post-deployment smoke tests. They run against a *live* container
 * (BASE_URL=http://pantry-staging:3000) and verify the deployment really works.
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/smoke/**/*.test.js'],
  testTimeout: 15000,
  reporters: [
    'default',
    ['jest-junit', { outputDirectory: 'reports', outputName: 'junit-smoke.xml', suiteNameTemplate: 'smoke › {filepath}' }],
  ],
};
