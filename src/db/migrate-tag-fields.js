const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'slocial.db'));

try {
  // Check if columns already exist
  const tableInfo = db.prepare("PRAGMA table_info(tags)").all();
  const columnNames = tableInfo.map(col => col.name);
  
  const columnsToAdd = [];
  
  if (!columnNames.includes('short_description')) {
    columnsToAdd.push('ALTER TABLE tags ADD COLUMN short_description TEXT;');
  }
  
  if (!columnNames.includes('long_description')) {
    columnsToAdd.push('ALTER TABLE tags ADD COLUMN long_description TEXT;');
  }
  
  if (!columnNames.includes('image_url')) {
    columnsToAdd.push('ALTER TABLE tags ADD COLUMN image_url TEXT;');
  }
  
  if (columnsToAdd.length > 0) {
    columnsToAdd.forEach(sql => {
      db.exec(sql);
      console.log(`✅ Executed: ${sql}`);
    });
    console.log('✅ Successfully added new fields to tags table');
  } else {
    console.log('ℹ️ All columns already exist, skipping migration');
  }
  
} catch (error) {
  console.error('❌ Migration failed:', error);
  process.exit(1);
} finally {
  db.close();
}
