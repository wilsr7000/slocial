const Database = require('better-sqlite3');
const path = require('path');

const dbFile = process.env.SQLITE_FILE || path.join(__dirname, 'slocial.db');
const db = new Database(dbFile);

// Check if is_admin column exists
const columns = db.prepare("PRAGMA table_info(users)").all();
const hasAdminColumn = columns.some(col => col.name === 'is_admin');

if (!hasAdminColumn) {
  console.log('Adding is_admin column to users table...');
  db.prepare('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0').run();
  console.log('Migration complete!');
} else {
  console.log('is_admin column already exists, skipping migration.');
}

// Make a specific user admin if ADMIN_EMAIL is set
if (process.env.ADMIN_EMAIL) {
  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(process.env.ADMIN_EMAIL);
  if (user) {
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(user.id);
    console.log(`Made user ${user.email} an admin.`);
  } else {
    console.log(`User with email ${process.env.ADMIN_EMAIL} not found.`);
  }
} else {
  // Make the first user an admin as fallback
  const firstUser = db.prepare('SELECT id, email FROM users ORDER BY id LIMIT 1').get();
  if (firstUser) {
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(firstUser.id);
    console.log(`Made first user ${firstUser.email} an admin.`);
  }
}

db.close();
