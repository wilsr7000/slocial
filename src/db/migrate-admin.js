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

// Only make robb@onereach.com an admin
const adminEmail = 'robb@onereach.com';
const adminUser = db.prepare('SELECT id, email, is_admin FROM users WHERE email = ?').get(adminEmail);

if (adminUser) {
  if (adminUser.is_admin !== 1) {
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(adminUser.id);
    console.log(`Made user ${adminUser.email} an admin.`);
  } else {
    console.log(`User ${adminUser.email} is already an admin.`);
  }
} else {
  console.log(`Admin user ${adminEmail} not found. Will be created when they sign up.`);
}

// Remove admin status from any other users who shouldn't have it
const wrongAdmins = db.prepare('SELECT id, email FROM users WHERE is_admin = 1 AND email != ?').all(adminEmail);
if (wrongAdmins.length > 0) {
  wrongAdmins.forEach(user => {
    db.prepare('UPDATE users SET is_admin = 0 WHERE id = ?').run(user.id);
    console.log(`Removed admin status from ${user.email}`);
  });
}

db.close();
