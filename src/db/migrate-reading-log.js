const Database = require('better-sqlite3');
const path = require('path');

// Connect to database  
const dbPath = process.env.SQLITE_FILE || path.join(__dirname, 'slocial.db');
const db = new Database(dbPath, { 
  verbose: console.log 
});

console.log('Creating reading log table...');

try {
  // Create reading_log table
  db.exec(`
    CREATE TABLE IF NOT EXISTS reading_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      letter_id INTEGER NOT NULL,
      action TEXT NOT NULL, -- 'view', 'read', 'skip', 'later', 'remove_later', 'resonate', 'unresonate'
      reading_time_seconds INTEGER, -- How long they spent reading (for 'read' actions)
      
      -- Letter metadata at time of reading (denormalized for historical accuracy)
      letter_title TEXT,
      letter_author_id INTEGER,
      letter_author_handle TEXT,
      letter_publish_date TEXT,
      letter_word_count INTEGER,
      letter_tags TEXT, -- JSON array of tag names
      
      -- Context metadata
      referrer_type TEXT, -- 'home', 'mosaic', 'direct', 'profile', etc.
      referrer_id TEXT, -- mosaic slug if from mosaic page, etc.
      device_type TEXT, -- 'desktop', 'mobile', 'tablet' (if we can detect)
      
      -- Timestamps
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      
      -- Foreign keys
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (letter_id) REFERENCES letters(id) ON DELETE CASCADE
    );
  `);
  
  console.log('✓ Created reading_log table');
  
  // Create indexes for common queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_reading_log_user_id 
    ON reading_log(user_id);
    
    CREATE INDEX IF NOT EXISTS idx_reading_log_letter_id 
    ON reading_log(letter_id);
    
    CREATE INDEX IF NOT EXISTS idx_reading_log_user_letter 
    ON reading_log(user_id, letter_id);
    
    CREATE INDEX IF NOT EXISTS idx_reading_log_created_at 
    ON reading_log(created_at);
    
    CREATE INDEX IF NOT EXISTS idx_reading_log_action 
    ON reading_log(action);
  `);
  
  console.log('✓ Created indexes for reading_log table');
  
  // Migrate existing reading_status data to create initial log entries
  const existingStatuses = db.prepare(`
    SELECT rs.*, l.title, l.author_id, l.publish_at, l.body,
           u.handle as author_handle
    FROM reading_status rs
    JOIN letters l ON l.id = rs.letter_id
    JOIN users u ON u.id = l.author_id
  `).all();
  
  if (existingStatuses.length > 0) {
    const insertStmt = db.prepare(`
      INSERT INTO reading_log (
        user_id, letter_id, action, 
        letter_title, letter_author_id, letter_author_handle,
        letter_publish_date, letter_word_count,
        referrer_type, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    let migrated = 0;
    for (const status of existingStatuses) {
      // Map status to action
      let action = status.status; // 'read', 'skip', 'later' map directly
      
      // Calculate approximate word count
      const wordCount = status.body ? status.body.split(/\s+/).length : 0;
      
      insertStmt.run(
        status.user_id,
        status.letter_id,
        action,
        status.title,
        status.author_id,
        status.author_handle,
        status.publish_at,
        wordCount,
        'migration',
        status.updated_at || status.created_at
      );
      migrated++;
    }
    
    console.log(`✓ Migrated ${migrated} existing reading statuses to log`);
  }
  
  console.log('✅ Reading log migration completed successfully!');
} catch (error) {
  console.error('Migration failed:', error.message);
  process.exit(1);
} finally {
  db.close();
}
