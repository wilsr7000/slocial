const Database = require('better-sqlite3');
const path = require('path');

const dbFile = process.env.SQLITE_FILE || path.join(__dirname, 'slocial.db');

function initializeDatabase() {
  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      handle TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      bio TEXT,
      avatar_url TEXT,
      oauth_provider TEXT,
      oauth_id TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(oauth_provider, oauth_id)
    );

    CREATE TABLE IF NOT EXISTS letters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      publish_at TEXT NOT NULL,
      is_published INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(author_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_letters_publish ON letters(is_published, publish_at DESC);
    CREATE INDEX IF NOT EXISTS idx_letters_author ON letters(author_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      letter_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(letter_id, author_id),
      FOREIGN KEY(letter_id) REFERENCES letters(id),
      FOREIGN KEY(author_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS resonates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      letter_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(letter_id, user_id),
      FOREIGN KEY(letter_id) REFERENCES letters(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS events (
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

    CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id);
    CREATE INDEX IF NOT EXISTS idx_events_event_type ON events(event_type);

    CREATE TABLE IF NOT EXISTS reading_status (
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

  return db;
}

module.exports = {
  initializeDatabase,
};


