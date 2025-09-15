const express = require('express');
const session = require('express-session');
const { buildRouter } = require('../../src/routes');
const TestDatabase = require('./database');

class TestApp {
  constructor() {
    this.app = null;
    this.db = null;
    this.testDatabase = null;
  }

  async setup() {
    // Set up test database
    this.testDatabase = new TestDatabase();
    this.db = await this.testDatabase.setup();
    
    // Create Express app
    this.app = express();
    
    // Middleware
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    
    // Session middleware (simplified for testing)
    this.app.use(session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false }
    }));
    
    // CSRF middleware mock
    this.app.use((req, res, next) => {
      req.csrfToken = () => 'test-csrf-token';
      res.locals.csrfToken = 'test-csrf-token';
      next();
    });
    
    // Build routes with test database
    const router = buildRouter(this.db);
    this.app.use('/', router);
    
    // Error handler
    this.app.use((err, req, res, next) => {
      console.error('Test error:', err);
      res.status(err.status || 500).json({
        error: err.message || 'Internal server error'
      });
    });
    
    return this.app;
  }

  async seed() {
    return await this.testDatabase.seed();
  }

  async teardown() {
    await this.testDatabase.teardown();
  }

  getApp() {
    return this.app;
  }

  getDb() {
    return this.db;
  }

  // Helper to create authenticated session
  authenticateUser(userId, userHandle = 'testuser', isAdmin = false) {
    return (req, res, next) => {
      req.session = {
        user: {
          id: userId,
          handle: userHandle,
          is_admin: isAdmin
        }
      };
      next();
    };
  }
}

module.exports = TestApp;
