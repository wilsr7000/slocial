const Database = require('better-sqlite3');
const path = require('path');

// Use the same database file as the application
const dbPath = process.env.SQLITE_FILE || path.join(__dirname, 'slocial.db');
const db = new Database(dbPath, { verbose: console.log });

try {
  console.log('Adding image_data column to tags table...');
  
  // Add image_data column to store image blobs
  db.exec(`
    ALTER TABLE tags ADD COLUMN image_data BLOB;
  `);
  console.log('✓ Added image_data column to tags table');
  
  // Create an index for tags that have images (for efficient queries)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tags_has_image 
    ON tags(id) WHERE image_data IS NOT NULL;
  `);
  console.log('✓ Created index for tags with images');
  
  console.log('✅ Image blob migration completed successfully!');
  console.log('Note: Existing image_url values are preserved for backward compatibility');
} catch (error) {
  if (error.message.includes('duplicate column name: image_data')) {
    console.log('✓ image_data column already exists');
  } else {
    console.error('Image blob migration failed:', error.message);
  }
} finally {
  db.close();
}
