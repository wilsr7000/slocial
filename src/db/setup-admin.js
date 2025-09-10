const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');

const dbFile = process.env.SQLITE_FILE || path.join(__dirname, 'slocial.db');
const db = new Database(dbFile);

// Default admin credentials
const DEFAULT_ADMIN = {
  email: 'robb@onereach.com',
  handle: 'admin',
  password: 'Passw0rd!'
};

// Check if admin user exists
const existingUser = db.prepare('SELECT id, email, is_admin FROM users WHERE email = ?').get(DEFAULT_ADMIN.email);

if (existingUser) {
  // User exists, make sure they're admin
  if (!existingUser.is_admin) {
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(existingUser.id);
    console.log(`Updated ${DEFAULT_ADMIN.email} to admin status.`);
  } else {
    console.log(`${DEFAULT_ADMIN.email} is already an admin.`);
  }
} else {
  // Create the admin user
  const password_hash = bcrypt.hashSync(DEFAULT_ADMIN.password, 12);
  try {
    const info = db.prepare('INSERT INTO users (handle, email, password_hash, is_admin) VALUES (?, ?, ?, 1)')
      .run(DEFAULT_ADMIN.handle, DEFAULT_ADMIN.email, password_hash);
    console.log(`Created admin user ${DEFAULT_ADMIN.email} with handle @${DEFAULT_ADMIN.handle}`);
    console.log('Password: Passw0rd!');
    console.log('Access admin panel at: /admin');
  } catch (e) {
    if (/UNIQUE/.test(e.message)) {
      console.log('Handle "admin" already taken. Trying with "admin1"...');
      const info = db.prepare('INSERT INTO users (handle, email, password_hash, is_admin) VALUES (?, ?, ?, 1)')
        .run('admin1', DEFAULT_ADMIN.email, password_hash);
      console.log(`Created admin user ${DEFAULT_ADMIN.email} with handle @admin1`);
      console.log('Password: Passw0rd!');
    } else {
      console.error('Failed to create admin user:', e.message);
    }
  }
}

db.close();
console.log('\nAdmin setup complete!');
