const Database = require('better-sqlite3');
const path = require('path');

const dbFile = process.env.SQLITE_FILE || path.join(__dirname, 'slocial.db');
const db = new Database(dbFile);

// Check if is_draft column exists
const columns = db.prepare("PRAGMA table_info(letters)").all();
const hasDraftColumn = columns.some(col => col.name === 'is_draft');
const hasSavedAtColumn = columns.some(col => col.name === 'last_saved_at');

if (!hasDraftColumn) {
  console.log('Adding is_draft column to letters table...');
  db.prepare('ALTER TABLE letters ADD COLUMN is_draft INTEGER NOT NULL DEFAULT 0').run();
  console.log('is_draft column added successfully!');
} else {
  console.log('is_draft column already exists.');
}

if (!hasSavedAtColumn) {
  console.log('Adding last_saved_at column to letters table...');
  db.prepare('ALTER TABLE letters ADD COLUMN last_saved_at TEXT').run();
  console.log('last_saved_at column added successfully!');
} else {
  console.log('last_saved_at column already exists.');
}

// Add index for drafts if it doesn't exist
const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_letters_drafts'").all();
if (indexes.length === 0) {
  console.log('Creating index for drafts...');
  db.prepare('CREATE INDEX idx_letters_drafts ON letters(author_id, is_draft, created_at DESC)').run();
  console.log('Draft index created successfully!');
}

db.close();
console.log('Draft migration complete!');
