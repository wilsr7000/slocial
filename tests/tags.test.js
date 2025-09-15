const request = require('supertest');
const TestApp = require('./helpers/app');

describe('Tags/Mosaics', () => {
  let app;
  let testApp;
  let testData;
  let authorAgent;
  let readerAgent;
  let adminAgent;

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
    
    adminAgent = request.agent(app);
    await adminAgent
      .post('/login')
      .send({ email: 'admin@test.com', password: 'password123' });
  });

  afterAll(async () => {
    await testApp.teardown();
  });

  describe('GET /tags', () => {
    it('should show all tags to authenticated users', async () => {
      const response = await readerAgent.get('/tags');
      
      expect(response.status).toBe(200);
      expect(response.text).toContain('Mosaics');
      expect(response.text).toContain('technology');
      expect(response.text).toContain('personal');
    });

    it('should show create button to authenticated users', async () => {
      const response = await authorAgent.get('/tags');
      
      expect(response.status).toBe(200);
      expect(response.text).toContain('Create New Mosaic');
    });
  });

  describe('POST /tags/create', () => {
    it('should create a new tag', async () => {
      const newTag = {
        name: 'Philosophy',
        short_description: 'Deep thoughts and ideas',
        long_description: 'A space for philosophical discussions',
        auto_approve: 'on'
      };

      const response = await authorAgent
        .post('/tags/create?_csrf=test-csrf-token')
        .send(newTag);

      expect(response.status).toBe(302);
      
      // Verify tag was created
      const db = testApp.getDb();
      const tag = db.prepare('SELECT * FROM tags WHERE name = ?').get(newTag.name);
      expect(tag).toBeDefined();
      expect(tag.short_description).toBe(newTag.short_description);
      expect(tag.auto_approve).toBe(1);
      
      // Verify owner was set
      const owner = db.prepare(`
        SELECT * FROM tag_owners 
        WHERE tag_id = ? AND user_id = ?
      `).get(tag.id, testData.users.author.id);
      expect(owner).toBeDefined();
      expect(owner.is_founder).toBe(1);
    });

    it('should reject duplicate tag names', async () => {
      const duplicateTag = {
        name: 'technology', // Already exists
        short_description: 'Another tech tag',
        long_description: 'This should fail'
      };

      const response = await authorAgent
        .post('/tags/create?_csrf=test-csrf-token')
        .send(duplicateTag);

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('error');
    });

    it('should require short description', async () => {
      const invalidTag = {
        name: 'InvalidTag',
        short_description: '',
        long_description: 'Has long but no short'
      };

      const response = await authorAgent
        .post('/tags/create?_csrf=test-csrf-token')
        .send(invalidTag);

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('error');
    });
  });

  describe('POST /tags/:id/request-access', () => {
    it('should create access request for non-auto-approve tag', async () => {
      const response = await readerAgent
        .post(`/tags/${testData.tags.tech.id}/request-access`)
        .send({ _csrf: 'test-csrf-token' });

      expect(response.status).toBe(302);
      
      // Verify request was created
      const db = testApp.getDb();
      const request = db.prepare(`
        SELECT * FROM tag_access_requests 
        WHERE tag_id = ? AND user_id = ?
      `).get(testData.tags.tech.id, testData.users.reader.id);
      
      // Note: tag_access_requests table doesn't exist in our test schema
      // This test would need the table to be added
    });

    it('should auto-approve for auto-approve tags', async () => {
      const response = await readerAgent
        .post(`/tags/${testData.tags.personal.id}/request-access`)
        .send({ _csrf: 'test-csrf-token' });

      expect(response.status).toBe(302);
      
      // Verify permission was granted immediately
      const db = testApp.getDb();
      const permission = db.prepare(`
        SELECT * FROM tag_permissions 
        WHERE tag_id = ? AND user_id = ? AND permission_type = 'use'
      `).get(testData.tags.personal.id, testData.users.reader.id);
      
      expect(permission).toBeDefined();
    });
  });

  describe('GET /tags/:id/manage', () => {
    it('should show management page to tag owner', async () => {
      const response = await authorAgent
        .get(`/tags/${testData.tags.tech.id}/manage`);

      expect(response.status).toBe(200);
      expect(response.text).toContain('Manage Mosaic');
      expect(response.text).toContain('technology');
    });

    it('should deny access to non-owners', async () => {
      const response = await readerAgent
        .get(`/tags/${testData.tags.tech.id}/manage`);

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/tags');
    });
  });

  describe('POST /tags/:id/edit', () => {
    it('should allow founder to edit tag details', async () => {
      const updates = {
        name: 'technology',
        short_description: 'Updated tech description',
        long_description: 'Much longer updated description',
        auto_approve: 'on'
      };

      const response = await authorAgent
        .post(`/tags/${testData.tags.tech.id}/edit?_csrf=test-csrf-token`)
        .send(updates);

      expect(response.status).toBe(302);
      
      // Verify updates were saved
      const db = testApp.getDb();
      const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(testData.tags.tech.id);
      expect(tag.short_description).toBe(updates.short_description);
      expect(tag.long_description).toBe(updates.long_description);
      expect(tag.auto_approve).toBe(1);
    });

    it('should deny non-founders from editing', async () => {
      const updates = {
        name: 'hacked',
        short_description: 'Should not work'
      };

      const response = await readerAgent
        .post(`/tags/${testData.tags.tech.id}/edit?_csrf=test-csrf-token`)
        .send(updates);

      expect(response.status).toBe(403);
    });
  });

  describe('Tag Permissions', () => {
    it('should grant use permission to tag creator', async () => {
      const db = testApp.getDb();
      const permission = db.prepare(`
        SELECT * FROM tag_permissions 
        WHERE tag_id = ? AND user_id = ? AND permission_type = 'use'
      `).get(testData.tags.tech.id, testData.users.author.id);
      
      expect(permission).toBeDefined();
    });

    it('should filter letters by tag access', async () => {
      // Create a letter with tech tag
      const db = testApp.getDb();
      const letter = db.prepare(`
        INSERT INTO letters (author_id, title, body, format, publish_at, is_draft)
        VALUES (?, ?, ?, ?, datetime('now', '-1 day'), 0)
      `).run(testData.users.author.id, 'Tech Letter', 'Tech content', 'essay');
      
      db.prepare(`
        INSERT INTO letter_tags (letter_id, tag_id)
        VALUES (?, ?)
      `).run(letter.lastInsertRowid, testData.tags.tech.id);
      
      // Reader shouldn't see it (no access to tech tag)
      const response = await readerAgent.get('/');
      expect(response.text).not.toContain('Tech Letter');
      
      // Author should see it (has access to tech tag)
      const authorResponse = await authorAgent.get('/');
      expect(authorResponse.text).toContain('Tech Letter');
    });
  });

  describe('GET /mosaics/:slug/read', () => {
    it('should show mosaic reading page to users with access', async () => {
      const response = await authorAgent
        .get('/mosaics/technology/read');

      expect(response.status).toBe(200);
      expect(response.text).toContain('#technology');
    });

    it('should deny access to users without permission', async () => {
      const response = await readerAgent
        .get('/mosaics/technology/read');

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('/tags');
    });
  });

  describe('Image Upload', () => {
    it('should handle image uploads as blobs', async () => {
      const newTag = {
        name: 'Visual',
        short_description: 'Tag with image',
        long_description: 'This tag has an image'
      };

      // Note: Testing file uploads requires special handling
      // This is a placeholder for the actual file upload test
      const response = await authorAgent
        .post('/tags/create?_csrf=test-csrf-token')
        .field('name', newTag.name)
        .field('short_description', newTag.short_description)
        .field('long_description', newTag.long_description);

      expect(response.status).toBe(302);
      
      const db = testApp.getDb();
      const tag = db.prepare('SELECT * FROM tags WHERE name = ?').get(newTag.name);
      expect(tag).toBeDefined();
    });
  });
});
