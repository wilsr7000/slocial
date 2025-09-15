// Test setup file - runs before each test suite
const path = require('path');

// Set test environment
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-key';
process.env.SQLITE_FILE = ':memory:'; // Use in-memory database for tests

// Suppress console logs during tests unless explicitly needed
if (process.env.SHOW_TEST_LOGS !== 'true') {
  global.console = {
    ...console,
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  };
}

// Global test utilities
global.testUtils = {
  // Generate random string for unique test data
  randomString: (length = 10) => {
    return Math.random().toString(36).substring(2, length + 2);
  },
  
  // Generate test email
  randomEmail: () => {
    return `test${Date.now()}@example.com`;
  },
  
  // Generate test handle
  randomHandle: () => {
    return `test${Date.now()}`.substring(0, 20);
  }
};

// Increase timeout for database operations
jest.setTimeout(10000);
