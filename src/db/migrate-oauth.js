const Database = require('better-sqlite3');
const path = require('path');

const dbFile = process.env.SQLITE_FILE || path.join(__dirname, 'slocial.db');
const db = new Database(dbFile);

// Check if oauth columns exist
const columns = db.prepare("PRAGMA table_info(users)").all();
const hasOAuthProvider = columns.some(col => col.name === 'oauth_provider');
const hasOAuthId = columns.some(col => col.name === 'oauth_id');

if (!hasOAuthProvider) {
  console.log('Adding oauth_provider column to users table...');
  db.prepare('ALTER TABLE users ADD COLUMN oauth_provider TEXT').run();
}

if (!hasOAuthId) {
  console.log('Adding oauth_id column to users table...');
  db.prepare('ALTER TABLE users ADD COLUMN oauth_id TEXT').run();
}

// Make password_hash nullable for OAuth users (can't alter NOT NULL constraint directly in SQLite)
// This is handled by the fact that new tables already have it nullable

console.log('OAuth migration complete!');
db.close();
