const Database = require('better-sqlite3');
const path = require('path');

// Connect to database
const dbPath = process.env.SQLITE_FILE || path.join(__dirname, 'slocial.db');
const db = new Database(dbPath, { 
  verbose: console.log 
});

console.log('Adding new columns to tags table...');

try {
  // Check if columns already exist
  const columns = db.prepare("PRAGMA table_info(tags)").all();
  const existingColumns = columns.map(col => col.name);
  
  // Add short_description column if it doesn't exist
  if (!existingColumns.includes('short_description')) {
    db.prepare(`
      ALTER TABLE tags 
      ADD COLUMN short_description TEXT
    `).run();
    console.log('✓ Added short_description column');
  } else {
    console.log('- short_description column already exists');
  }
  
  // Add long_description column if it doesn't exist
  if (!existingColumns.includes('long_description')) {
    db.prepare(`
      ALTER TABLE tags 
      ADD COLUMN long_description TEXT
    `).run();
    console.log('✓ Added long_description column');
  } else {
    console.log('- long_description column already exists');
  }
  
  // Add image_url column if it doesn't exist
  if (!existingColumns.includes('image_url')) {
    db.prepare(`
      ALTER TABLE tags 
      ADD COLUMN image_url TEXT
    `).run();
    console.log('✓ Added image_url column');
  } else {
    console.log('- image_url column already exists');
  }
  
  // Add auto_approve column if it doesn't exist
  if (!existingColumns.includes('auto_approve')) {
    db.prepare(`
      ALTER TABLE tags 
      ADD COLUMN auto_approve INTEGER NOT NULL DEFAULT 0
    `).run();
    console.log('✓ Added auto_approve column');
  } else {
    console.log('- auto_approve column already exists');
  }
  
  console.log('\n✅ Migration completed successfully!');
  
} catch (error) {
  console.error('❌ Migration failed:', error);
  process.exit(1);
} finally {
  db.close();
}
