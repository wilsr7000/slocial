const request = require('supertest');
const TestApp = require('./helpers/app');

describe('Authentication', () => {
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

  describe('POST /signup', () => {
    it('should create a new user with valid data', async () => {
      const newUser = {
        email: 'newuser@test.com',
        password: 'SecurePass123',
        confirmPassword: 'SecurePass123',
        handle: 'newuser'
      };

      const response = await request(app)
        .post('/signup')
        .send(newUser);

      expect(response.status).toBe(302); // Redirect after signup
      
      // Verify user was created in database
      const db = testApp.getDb();
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(newUser.email);
      expect(user).toBeDefined();
      expect(user.handle).toBe(newUser.handle);
      expect(user.is_slocialite).toBe(1); // Default reader status
    });

    it('should reject duplicate email', async () => {
      const duplicateUser = {
        email: 'admin@test.com', // Already exists
        password: 'SecurePass123',
        confirmPassword: 'SecurePass123',
        handle: 'newhandle'
      };

      const response = await request(app)
        .post('/signup')
        .send(duplicateUser);

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('signup');
    });

    it('should reject duplicate handle', async () => {
      const duplicateHandle = {
        email: 'unique@test.com',
        password: 'SecurePass123',
        confirmPassword: 'SecurePass123',
        handle: 'admin' // Already exists
      };

      const response = await request(app)
        .post('/signup')
        .send(duplicateHandle);

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('signup');
    });

    it('should reject mismatched passwords', async () => {
      const mismatchedPasswords = {
        email: 'mismatch@test.com',
        password: 'SecurePass123',
        confirmPassword: 'DifferentPass123',
        handle: 'mismatch'
      };

      const response = await request(app)
        .post('/signup')
        .send(mismatchedPasswords);

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('signup');
    });

    it('should reject invalid handle format', async () => {
      const invalidHandle = {
        email: 'invalid@test.com',
        password: 'SecurePass123',
        confirmPassword: 'SecurePass123',
        handle: 'ab' // Too short, must be 3-20 chars
      };

      const response = await request(app)
        .post('/signup')
        .send(invalidHandle);

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('signup');
    });
  });

  describe('POST /login', () => {
    it('should login with valid credentials', async () => {
      const credentials = {
        email: 'author@test.com',
        password: 'password123'
      };

      const response = await request(app)
        .post('/login')
        .send(credentials);

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/'); // Redirect to home
    });

    it('should reject invalid email', async () => {
      const invalidEmail = {
        email: 'nonexistent@test.com',
        password: 'password123'
      };

      const response = await request(app)
        .post('/login')
        .send(invalidEmail);

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('login');
    });

    it('should reject invalid password', async () => {
      const invalidPassword = {
        email: 'author@test.com',
        password: 'wrongpassword'
      };

      const response = await request(app)
        .post('/login')
        .send(invalidPassword);

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('login');
    });
  });

  describe('POST /logout', () => {
    it('should logout authenticated user', async () => {
      const agent = request.agent(app);
      
      // First login
      await agent
        .post('/login')
        .send({
          email: 'author@test.com',
          password: 'password123'
        });

      // Then logout
      const response = await agent
        .post('/logout')
        .send({ _csrf: 'test-csrf-token' });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/');
    });
  });

  describe('Protected Routes', () => {
    it('should redirect unauthenticated users from /compose', async () => {
      const response = await request(app)
        .get('/compose');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/login');
    });

    it('should allow authenticated users to access /compose', async () => {
      const agent = request.agent(app);
      
      // Login first
      await agent
        .post('/login')
        .send({
          email: 'author@test.com',
          password: 'password123'
        });

      // Access protected route
      const response = await agent
        .get('/compose');

      expect(response.status).toBe(200);
    });

    it('should redirect non-admin users from /admin', async () => {
      const agent = request.agent(app);
      
      // Login as regular user
      await agent
        .post('/login')
        .send({
          email: 'author@test.com',
          password: 'password123'
        });

      const response = await agent
        .get('/admin');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/');
    });

    it('should allow admin users to access /admin', async () => {
      const agent = request.agent(app);
      
      // Login as admin
      await agent
        .post('/login')
        .send({
          email: 'admin@test.com',
          password: 'password123'
        });

      const response = await agent
        .get('/admin');

      expect(response.status).toBe(200);
    });
  });
});
