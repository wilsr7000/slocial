const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');

const dbPath = path.join(__dirname, 'src/db/slocial.db');
const db = new Database(dbPath);

// Test user credentials
const email = 'test@example.com';
const password = 'password123';
const handle = 'testuser';

async function createTestUser() {
  try {
    // Check if user already exists
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    
    if (existing) {
      console.log('✅ Test user already exists!');
      console.log('Email:', email);
      console.log('Password:', password);
      return;
    }
    
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create the user
    const result = db.prepare(`
      INSERT INTO users (email, password_hash, handle, is_slocialite)
      VALUES (?, ?, ?, 0)
    `).run(email, hashedPassword, handle);
    
    console.log('✅ Test user created successfully!');
    console.log('Email:', email);
    console.log('Password:', password);
    console.log('Handle:', handle);
    console.log('User ID:', result.lastInsertRowid);
    
    // Grant public tag permission
    const publicTag = db.prepare('SELECT id FROM tags WHERE slug = ?').get('public');
    if (publicTag) {
      db.prepare(`
        INSERT OR IGNORE INTO tag_permissions (tag_id, user_id, permission_type, granted_by)
        VALUES (?, ?, 'use', 1)
      `).run(publicTag.id, result.lastInsertRowid);
      console.log('✅ Granted access to public tag');
    }
    
  } catch (error) {
    console.error('❌ Error creating user:', error.message);
  } finally {
    db.close();
  }
}

createTestUser();
