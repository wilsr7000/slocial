const Database = require('better-sqlite3');
const path = require('path');

const dbFile = process.env.SQLITE_FILE || path.join(__dirname, 'slocial.db');
const db = new Database(dbFile);

// Check if bio column exists
const columns = db.prepare("PRAGMA table_info(users)").all();
const hasBio = columns.some(col => col.name === 'bio');
const hasAvatar = columns.some(col => col.name === 'avatar_url');

if (!hasBio) {
  console.log('Adding bio column to users table...');
  db.prepare('ALTER TABLE users ADD COLUMN bio TEXT').run();
}

if (!hasAvatar) {
  console.log('Adding avatar_url column to users table...');
  db.prepare('ALTER TABLE users ADD COLUMN avatar_url TEXT').run();
}

console.log('Profile migration complete!');
db.close();
