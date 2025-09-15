# Slocial Test Suite

## Overview
This directory contains the test suite for Slocial, built with Jest and Supertest.

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode (for development)
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run specific test suites
npm run test:auth      # Authentication tests
npm run test:letters   # Letter CRUD tests
npm run test:tags      # Tag/Mosaic tests

# Run tests with console output visible
npm run test:verbose
```

## Test Structure

```
tests/
├── helpers/           # Test utilities
│   ├── app.js        # Express app setup for testing
│   └── database.js   # In-memory database setup
├── mocks/            # Mock libraries
│   └── marked.js     # Mock for marked library
├── auth.test.js      # Authentication tests
├── letters.test.js   # Letter functionality tests
├── tags.test.js      # Tag/Mosaic tests
└── setup.js         # Global test setup
```

## Key Features

- **In-Memory Database**: Tests use SQLite in-memory database for fast, isolated testing
- **Seeded Test Data**: Each test suite gets fresh test data (users, tags, letters)
- **Authenticated Agents**: Test helpers for making authenticated requests
- **Mock Libraries**: Mocked external dependencies to avoid ESM issues

## Test Data

The test database is seeded with:
- **Users**: admin@test.com, author@test.com, reader@test.com (password: password123)
- **Tags**: public, technology, personal
- **Letters**: published, draft, scheduled

## Writing New Tests

Example test structure:

```javascript
const request = require('supertest');
const TestApp = require('./helpers/app');

describe('Feature Name', () => {
  let app;
  let testApp;
  let testData;

  beforeAll(async () => {
    testApp = new TestApp();
    app = await testApp.setup();
    testData = await testApp.seed();
  });

  afterAll(async () => {
    await testApp.teardown();
  });

  it('should do something', async () => {
    const response = await request(app)
      .get('/some-endpoint')
      .expect(200);
    
    expect(response.body).toHaveProperty('someField');
  });
});
```

## Known Issues

- Some tests may fail due to implementation differences between test and production environments
- Marked library is mocked to avoid ESM compatibility issues
- OAuth tests are not implemented (require mocking passport strategies)

## Next Steps

For E2E testing, consider adding:
- Playwright for browser automation
- Visual regression testing
- Performance benchmarks
- Load testing with k6 or similar
