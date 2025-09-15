const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

class TestDatabase {
  constructor() {
    this.db = null;
  }

  // Initialize test database
  async setup() {
    // Create in-memory database
    this.db = new Database(':memory:');
    
    // Run initialization script
    const initScript = fs.readFileSync(
      path.join(__dirname, '../../src/db/init.js'), 
      'utf8'
    );
    
    // Execute the init script's SQL
    this.initializeSchema();
    
    return this.db;
  }

  // Initialize database schema
  initializeSchema() {
    // Users table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        handle TEXT UNIQUE NOT NULL,
        is_admin INTEGER DEFAULT 0,
        is_slocialite INTEGER DEFAULT 1,
        oauth_provider TEXT,
        oauth_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);

    // Letters table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS letters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        author_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        format TEXT DEFAULT 'essay',
        publish_at TEXT,
        is_draft INTEGER DEFAULT 0,
        parent_id INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES letters(id) ON DELETE CASCADE
      );
    `);

    // Tags table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL COLLATE NOCASE,
        slug TEXT UNIQUE NOT NULL,
        description TEXT,
        short_description TEXT,
        long_description TEXT,
        image_url TEXT,
        image_data BLOB,
        created_by INTEGER NOT NULL,
        is_public INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        auto_approve INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    // Tag permissions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tag_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        permission_type TEXT NOT NULL,
        granted_by INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (granted_by) REFERENCES users(id),
        UNIQUE(tag_id, user_id, permission_type)
      );
    `);

    // Letter tags table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS letter_tags (
        letter_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (letter_id, tag_id),
        FOREIGN KEY (letter_id) REFERENCES letters(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      );
    `);

    // Tag owners table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tag_owners (
        tag_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        is_founder INTEGER DEFAULT 0,
        added_by INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (tag_id, user_id),
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (added_by) REFERENCES users(id)
      );
    `);

    // Reading status table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reading_status (
        user_id INTEGER NOT NULL,
        letter_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        resonated INTEGER DEFAULT 0,
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, letter_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (letter_id) REFERENCES letters(id) ON DELETE CASCADE
      );
    `);

    // Sessions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expired TEXT NOT NULL
      );
    `);

    // Create public tag
    this.createPublicTag();
  }

  // Create the default public tag
  createPublicTag() {
    // First create a system user if it doesn't exist
    this.db.prepare(`
      INSERT OR IGNORE INTO users (id, email, password, handle, is_admin, is_slocialite)
      VALUES (1, 'system@slocial.org', 'no-login', 'system', 1, 0)
    `).run();
    
    // Then create the public tag
    const publicTag = this.db.prepare(`
      INSERT OR IGNORE INTO tags (name, slug, description, created_by, is_public, is_active)
      VALUES ('public', 'public', 'Public content visible to all users', 1, 1, 1)
    `).run();
  }

  // Seed test data
  async seed() {
    // Create test users
    const users = await this.createTestUsers();
    
    // Create test tags
    const tags = await this.createTestTags(users);
    
    // Create test letters
    const letters = await this.createTestLetters(users, tags);
    
    return { users, tags, letters };
  }

  // Create test users
  async createTestUsers() {
    const password = await bcrypt.hash('password123', 10);
    
    const admin = this.db.prepare(`
      INSERT INTO users (email, password, handle, is_admin, is_slocialite)
      VALUES (?, ?, ?, 1, 0)
    `).run('admin@test.com', password, 'admin');
    
    const author = this.db.prepare(`
      INSERT INTO users (email, password, handle, is_admin, is_slocialite)
      VALUES (?, ?, ?, 0, 0)
    `).run('author@test.com', password, 'author');
    
    const reader = this.db.prepare(`
      INSERT INTO users (email, password, handle, is_admin, is_slocialite)
      VALUES (?, ?, ?, 0, 1)
    `).run('reader@test.com', password, 'reader');
    
    return {
      admin: { id: admin.lastInsertRowid, email: 'admin@test.com', handle: 'admin' },
      author: { id: author.lastInsertRowid, email: 'author@test.com', handle: 'author' },
      reader: { id: reader.lastInsertRowid, email: 'reader@test.com', handle: 'reader' }
    };
  }

  // Create test tags
  async createTestTags(users) {
    const publicTag = this.db.prepare(`
      SELECT * FROM tags WHERE slug = 'public'
    `).get();
    
    const techTag = this.db.prepare(`
      INSERT INTO tags (name, slug, description, short_description, created_by, is_public)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('technology', 'technology', 'Tech discussions', 'Tech', users.author.id, 0);
    
    const personalTag = this.db.prepare(`
      INSERT INTO tags (name, slug, description, short_description, created_by, is_public, auto_approve)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('personal', 'personal', 'Personal stories', 'Personal', users.author.id, 0, 1);
    
    // Set up permissions
    this.db.prepare(`
      INSERT INTO tag_permissions (tag_id, user_id, permission_type, granted_by)
      VALUES (?, ?, ?, ?)
    `).run(techTag.lastInsertRowid, users.author.id, 'use', users.author.id);
    
    this.db.prepare(`
      INSERT INTO tag_owners (tag_id, user_id, is_founder)
      VALUES (?, ?, ?)
    `).run(techTag.lastInsertRowid, users.author.id, 1);
    
    return {
      public: publicTag,
      tech: { id: techTag.lastInsertRowid, name: 'technology', slug: 'technology' },
      personal: { id: personalTag.lastInsertRowid, name: 'personal', slug: 'personal' }
    };
  }

  // Create test letters
  async createTestLetters(users, tags) {
    const now = new Date().toISOString();
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const published = this.db.prepare(`
      INSERT INTO letters (author_id, title, body, format, publish_at, is_draft)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(users.author.id, 'Published Letter', 'This is a published letter.', 'essay', past, 0);
    
    const draft = this.db.prepare(`
      INSERT INTO letters (author_id, title, body, format, publish_at, is_draft)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(users.author.id, 'Draft Letter', 'This is a draft.', 'essay', now, 1);
    
    const scheduled = this.db.prepare(`
      INSERT INTO letters (author_id, title, body, format, publish_at, is_draft)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(users.author.id, 'Scheduled Letter', 'This will publish later.', 'essay', 
      new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(), 0);
    
    // Add tags to published letter
    this.db.prepare(`
      INSERT INTO letter_tags (letter_id, tag_id)
      VALUES (?, ?)
    `).run(published.lastInsertRowid, tags.public.id);
    
    return {
      published: { id: published.lastInsertRowid, title: 'Published Letter' },
      draft: { id: draft.lastInsertRowid, title: 'Draft Letter' },
      scheduled: { id: scheduled.lastInsertRowid, title: 'Scheduled Letter' }
    };
  }

  // Clean up database
  async teardown() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // Get database instance
  getDb() {
    return this.db;
  }
}

module.exports = TestDatabase;
