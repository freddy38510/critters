module.exports = {
  "testEnvironment": "node",
  "coverageReporters": [
    "text"
  ],
  "moduleNameMapper": {
    "^@freddy38510/critters$": "<rootDir>/packages/critters/src/index.js"
  },
  "collectCoverageFrom": [
    "packages/*/src/**/*.js"
  ],
  "modulePaths": [
    "<rootDir>/packages/critters-webpack-plugin/node_modules",
    "<rootDir>/packages/critters/node_modules",
  ],
  "watchPathIgnorePatterns": [
    "node_modules",
    "dist"
  ]
}
