#!/usr/bin/env node
const Database = require('better-sqlite3');
const path = require('path');

const dbFile = process.env.SQLITE_FILE || path.join(__dirname, 'slocial.db');
const db = new Database(dbFile);

console.log('Starting migration: Adding draft columns to letters table...');

try {
  // Check if columns already exist
  const columns = db.prepare("PRAGMA table_info(letters)").all();
  const hasIsDraft = columns.some(col => col.name === 'is_draft');
  const hasLastSavedAt = columns.some(col => col.name === 'last_saved_at');
  
  if (!hasIsDraft) {
    console.log('Adding is_draft column...');
    db.prepare('ALTER TABLE letters ADD COLUMN is_draft INTEGER NOT NULL DEFAULT 0').run();
    console.log('✓ is_draft column added');
  } else {
    console.log('✓ is_draft column already exists');
  }
  
  if (!hasLastSavedAt) {
    console.log('Adding last_saved_at column...');
    db.prepare('ALTER TABLE letters ADD COLUMN last_saved_at TEXT').run();
    console.log('✓ last_saved_at column added');
  } else {
    console.log('✓ last_saved_at column already exists');
  }
  
  // Create index for drafts if it doesn't exist
  try {
    db.prepare('CREATE INDEX idx_letters_drafts ON letters(author_id, is_draft, created_at DESC)').run();
    console.log('✓ Draft index created');
  } catch (e) {
    if (e.message.includes('already exists')) {
      console.log('✓ Draft index already exists');
    } else {
      throw e;
    }
  }
  
  console.log('\nMigration completed successfully!');
  
  // Show current schema
  console.log('\nCurrent letters table schema:');
  const newColumns = db.prepare("PRAGMA table_info(letters)").all();
  newColumns.forEach(col => {
    console.log(`  - ${col.name}: ${col.type}${col.notnull ? ' NOT NULL' : ''}${col.dflt_value ? ` DEFAULT ${col.dflt_value}` : ''}`);
  });
  
} catch (error) {
  console.error('Migration failed:', error);
  process.exit(1);
}

db.close();
console.log('\nDatabase connection closed.');
