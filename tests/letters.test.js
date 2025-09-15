const request = require('supertest');
const TestApp = require('./helpers/app');

describe('Letters', () => {
  let app;
  let testApp;
  let testData;
  let authorAgent;
  let readerAgent;

  beforeAll(async () => {
    testApp = new TestApp();
    app = await testApp.setup();
    testData = await testApp.seed();
    
    // Create authenticated agents
    authorAgent = request.agent(app);
    await authorAgent
      .post('/login')
      .send({ email: 'author@test.com', password: 'password123' });
    
    readerAgent = request.agent(app);
    await readerAgent
      .post('/login')
      .send({ email: 'reader@test.com', password: 'password123' });
  });

  afterAll(async () => {
    await testApp.teardown();
  });

  describe('GET /', () => {
    it('should show published letters to authenticated users', async () => {
      const response = await readerAgent.get('/');
      
      expect(response.status).toBe(200);
      expect(response.text).toContain('Published Letter');
      expect(response.text).not.toContain('Draft Letter');
    });

    it('should show empty state to unauthenticated users', async () => {
      const response = await request(app).get('/');
      
      expect(response.status).toBe(200);
      expect(response.text).toContain('Slow letters, lasting resonance');
    });
  });

  describe('POST /compose', () => {
    it('should create a new letter as author', async () => {
      const newLetter = {
        title: 'Test Letter',
        body: 'This is a test letter with enough content to be valid.',
        format: 'essay',
        tags: 'public'
      };

      const response = await authorAgent
        .post('/compose')
        .send(newLetter);

      expect(response.status).toBe(302);
      
      // Verify letter was created
      const db = testApp.getDb();
      const letter = db.prepare('SELECT * FROM letters WHERE title = ?').get(newLetter.title);
      expect(letter).toBeDefined();
      expect(letter.body).toBe(newLetter.body);
      expect(letter.is_draft).toBe(0);
    });

    it('should reject letters from readers (slocialites)', async () => {
      const newLetter = {
        title: 'Reader Letter',
        body: 'This letter should not be created.',
        format: 'essay',
        tags: 'public'
      };

      const response = await readerAgent
        .post('/compose')
        .send(newLetter);

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/');
      
      // Verify letter was NOT created
      const db = testApp.getDb();
      const letter = db.prepare('SELECT * FROM letters WHERE title = ?').get(newLetter.title);
      expect(letter).toBeUndefined();
    });

    it('should save as draft when requested', async () => {
      const draftLetter = {
        title: 'Draft Test',
        body: 'This is a draft.',
        format: 'essay',
        action: 'draft',
        tags: ''
      };

      const response = await authorAgent
        .post('/compose')
        .send(draftLetter);

      expect(response.status).toBe(302);
      
      // Verify draft was created
      const db = testApp.getDb();
      const letter = db.prepare('SELECT * FROM letters WHERE title = ?').get(draftLetter.title);
      expect(letter).toBeDefined();
      expect(letter.is_draft).toBe(1);
    });

    it('should reject empty title', async () => {
      const invalidLetter = {
        title: '',
        body: 'This letter has no title.',
        format: 'essay',
        tags: 'public'
      };

      const response = await authorAgent
        .post('/compose')
        .send(invalidLetter);

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('compose');
    });

    it('should reject empty body', async () => {
      const invalidLetter = {
        title: 'Empty Body',
        body: '',
        format: 'essay',
        tags: 'public'
      };

      const response = await authorAgent
        .post('/compose')
        .send(invalidLetter);

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('compose');
    });
  });

  describe('GET /letters/:id', () => {
    it('should show published letter', async () => {
      const response = await readerAgent
        .get(`/letters/${testData.letters.published.id}`);

      expect(response.status).toBe(200);
      expect(response.text).toContain(testData.letters.published.title);
    });

    it('should not show draft to non-author', async () => {
      const response = await readerAgent
        .get(`/letters/${testData.letters.draft.id}`);

      expect(response.status).toBe(404);
    });

    it('should show draft to author', async () => {
      const response = await authorAgent
        .get(`/letters/${testData.letters.draft.id}`);

      expect(response.status).toBe(200);
      expect(response.text).toContain(testData.letters.draft.title);
    });

    it('should return 404 for non-existent letter', async () => {
      const response = await readerAgent
        .get('/letters/999999');

      expect(response.status).toBe(404);
    });
  });

  describe('POST /letters/:id/status', () => {
    it('should update reading status', async () => {
      const response = await readerAgent
        .post(`/letters/${testData.letters.published.id}/status`)
        .send({
          status: 'read',
          _csrf: 'test-csrf-token'
        });

      expect(response.status).toBe(302);
      
      // Verify status was saved
      const db = testApp.getDb();
      const status = db.prepare(`
        SELECT * FROM reading_status 
        WHERE user_id = ? AND letter_id = ?
      `).get(testData.users.reader.id, testData.letters.published.id);
      
      expect(status).toBeDefined();
      expect(status.status).toBe('read');
    });

    it('should toggle resonate status', async () => {
      const response = await readerAgent
        .post(`/letters/${testData.letters.published.id}/status`)
        .send({
          status: 'resonate',
          _csrf: 'test-csrf-token'
        });

      expect(response.status).toBe(302);
      
      // Verify resonance was saved
      const db = testApp.getDb();
      const status = db.prepare(`
        SELECT * FROM reading_status 
        WHERE user_id = ? AND letter_id = ?
      `).get(testData.users.reader.id, testData.letters.published.id);
      
      expect(status).toBeDefined();
      expect(status.resonated).toBe(1);
    });
  });

  describe('GET /drafts', () => {
    it('should show author drafts', async () => {
      const response = await authorAgent
        .get('/drafts');

      expect(response.status).toBe(200);
      expect(response.text).toContain('Draft Letter');
    });

    it('should show empty state for reader', async () => {
      const response = await readerAgent
        .get('/drafts');

      expect(response.status).toBe(200);
      expect(response.text).toContain('No drafts');
    });
  });

  describe('Letter Formats', () => {
    it('should accept haiku format', async () => {
      const haiku = {
        title: 'Test Haiku',
        body: 'Ancient pond awaits\nA frog jumps into water\nSound of the splash heard',
        format: 'haiku',
        tags: 'public'
      };

      const response = await authorAgent
        .post('/compose')
        .send(haiku);

      expect(response.status).toBe(302);
      
      const db = testApp.getDb();
      const letter = db.prepare('SELECT * FROM letters WHERE title = ?').get(haiku.title);
      expect(letter).toBeDefined();
      expect(letter.format).toBe('haiku');
    });

    it('should accept sixword format', async () => {
      const sixword = {
        title: 'Six Word Story',
        body: 'For sale: baby shoes, never worn.',
        format: 'sixword',
        tags: 'public'
      };

      const response = await authorAgent
        .post('/compose')
        .send(sixword);

      expect(response.status).toBe(302);
      
      const db = testApp.getDb();
      const letter = db.prepare('SELECT * FROM letters WHERE title = ?').get(sixword.title);
      expect(letter).toBeDefined();
      expect(letter.format).toBe('sixword');
    });
  });
});
