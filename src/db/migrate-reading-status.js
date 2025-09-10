const Database = require('better-sqlite3');
const path = require('path');

const dbFile = process.env.SQLITE_FILE || path.join(__dirname, 'slocial.db');
const db = new Database(dbFile);

// Check if reading_status table exists
const tableExists = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='reading_status'"
).get();

if (!tableExists) {
  console.log('Creating reading_status table...');
  
  db.exec(`
    CREATE TABLE reading_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      letter_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('read', 'skip', 'later', 'reading')),
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (letter_id) REFERENCES letters(id) ON DELETE CASCADE,
      UNIQUE(user_id, letter_id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_reading_status_user ON reading_status(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_reading_status_letter ON reading_status(letter_id);
  `);
  
  console.log('reading_status table created successfully!');
} else {
  console.log('reading_status table already exists, skipping migration.');
}

db.close();
