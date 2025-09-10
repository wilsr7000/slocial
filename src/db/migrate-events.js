const Database = require('better-sqlite3');
const path = require('path');

const dbFile = process.env.SQLITE_FILE || path.join(__dirname, 'slocial.db');
const db = new Database(dbFile);

// Check if events table exists
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='events'").all();
const hasEventsTable = tables.length > 0;

if (!hasEventsTable) {
  console.log('Creating events table...');
  db.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      user_id INTEGER,
      session_id TEXT,
      ip_address TEXT,
      user_agent TEXT,
      path TEXT,
      method TEXT,
      letter_id INTEGER,
      duration_ms INTEGER,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (letter_id) REFERENCES letters(id) ON DELETE SET NULL
    );

    CREATE INDEX idx_events_created_at ON events(created_at DESC);
    CREATE INDEX idx_events_user_id ON events(user_id);
    CREATE INDEX idx_events_event_type ON events(event_type);
  `);
  console.log('Events table created successfully!');
} else {
  console.log('Events table already exists.');
}

db.close();
console.log('Events migration complete!');
