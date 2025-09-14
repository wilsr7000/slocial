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
    
    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      creator_id INTEGER NOT NULL,
      is_approved INTEGER NOT NULL DEFAULT 0,
      is_public INTEGER NOT NULL DEFAULT 1,
      member_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT,
      approved_by INTEGER,
      FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
    );
    
    CREATE TABLE IF NOT EXISTS channel_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member', 'moderator', 'owner')),
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(channel_id, user_id)
    );
    
    CREATE TABLE IF NOT EXISTS channel_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected', 'cancelled')),
      message TEXT,
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      responded_at TEXT,
      responded_by INTEGER,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (responded_by) REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE(channel_id, user_id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_channels_approved ON channels(is_approved, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_channel_members_user ON channel_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_channel_members_channel ON channel_members(channel_id);
    CREATE INDEX IF NOT EXISTS idx_channel_invites_status ON channel_invites(status, requested_at DESC);
    
    CREATE TABLE IF NOT EXISTS sorts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      color TEXT DEFAULT '#6366f1',
      icon TEXT,
      is_system INTEGER NOT NULL DEFAULT 0,
      display_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by INTEGER,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_sorts_slug ON sorts(slug);
    CREATE INDEX IF NOT EXISTS idx_sorts_display_order ON sorts(display_order, name);
    
    CREATE TABLE IF NOT EXISTS letter_sorts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      letter_id INTEGER NOT NULL,
      sort_id INTEGER NOT NULL,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      added_by INTEGER,
      FOREIGN KEY (letter_id) REFERENCES letters(id) ON DELETE CASCADE,
      FOREIGN KEY (sort_id) REFERENCES sorts(id) ON DELETE CASCADE,
      FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE(letter_id, sort_id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_letter_sorts_letter ON letter_sorts(letter_id);
    CREATE INDEX IF NOT EXISTS idx_letter_sorts_sort ON letter_sorts(sort_id);
    CREATE INDEX IF NOT EXISTS idx_letter_sorts_added_at ON letter_sorts(added_at DESC);
    
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      short_description TEXT,
      long_description TEXT,
      image_url TEXT,
      created_by INTEGER NOT NULL,
      is_public INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    );
    
    CREATE INDEX IF NOT EXISTS idx_tags_slug ON tags(slug);
    CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_tags_created_by ON tags(created_by);
    CREATE INDEX IF NOT EXISTS idx_tags_usage ON tags(usage_count DESC);
    CREATE INDEX IF NOT EXISTS idx_tags_active ON tags(is_active, is_public);
    
    CREATE TABLE IF NOT EXISTS tag_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag_id INTEGER NOT NULL,
      user_id INTEGER,
      permission_type TEXT NOT NULL CHECK(permission_type IN ('use', 'edit', 'delete', 'grant')),
      granted_by INTEGER NOT NULL,
      granted_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(tag_id, user_id, permission_type)
    );
    
    CREATE INDEX IF NOT EXISTS idx_tag_permissions_tag ON tag_permissions(tag_id);
    CREATE INDEX IF NOT EXISTS idx_tag_permissions_user ON tag_permissions(user_id);
    CREATE INDEX IF NOT EXISTS idx_tag_permissions_type ON tag_permissions(permission_type);
    CREATE INDEX IF NOT EXISTS idx_tag_permissions_expires ON tag_permissions(expires_at);
    
    CREATE TABLE IF NOT EXISTS letter_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      letter_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      added_by INTEGER NOT NULL,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (letter_id) REFERENCES letters(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
      FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(letter_id, tag_id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_letter_tags_letter ON letter_tags(letter_id);
    CREATE INDEX IF NOT EXISTS idx_letter_tags_tag ON letter_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_letter_tags_added_at ON letter_tags(added_at DESC);
    CREATE INDEX IF NOT EXISTS idx_letter_tags_added_by ON letter_tags(added_by);
    
    CREATE TABLE IF NOT EXISTS tag_followers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      followed_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(tag_id, user_id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_tag_followers_tag ON tag_followers(tag_id);
    CREATE INDEX IF NOT EXISTS idx_tag_followers_user ON tag_followers(user_id);
    
    CREATE TABLE IF NOT EXISTS tag_owners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      ownership_type TEXT NOT NULL DEFAULT 'owner' CHECK(ownership_type IN ('owner', 'co-owner', 'founder')),
      granted_by INTEGER,
      granted_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_active INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE(tag_id, user_id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_tag_owners_tag ON tag_owners(tag_id);
    CREATE INDEX IF NOT EXISTS idx_tag_owners_user ON tag_owners(user_id);
    CREATE INDEX IF NOT EXISTS idx_tag_owners_active ON tag_owners(is_active);
    CREATE INDEX IF NOT EXISTS idx_tag_owners_type ON tag_owners(ownership_type);
    
    CREATE TABLE IF NOT EXISTS tag_ownership_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('added', 'removed', 'promoted', 'demoted', 'transferred')),
      performed_by INTEGER NOT NULL,
      performed_at TEXT NOT NULL DEFAULT (datetime('now')),
      reason TEXT,
      previous_type TEXT,
      new_type TEXT,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE CASCADE
    );
    
    CREATE INDEX IF NOT EXISTS idx_tag_ownership_history_tag ON tag_ownership_history(tag_id);
    CREATE INDEX IF NOT EXISTS idx_tag_ownership_history_user ON tag_ownership_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_tag_ownership_history_date ON tag_ownership_history(performed_at DESC);
    
    CREATE TABLE IF NOT EXISTS tag_access_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'cancelled')),
      request_message TEXT,
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      responded_at TEXT,
      responded_by INTEGER,
      response_message TEXT,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (responded_by) REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE(tag_id, user_id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_tag_access_requests_tag ON tag_access_requests(tag_id);
    CREATE INDEX IF NOT EXISTS idx_tag_access_requests_user ON tag_access_requests(user_id);
    CREATE INDEX IF NOT EXISTS idx_tag_access_requests_status ON tag_access_requests(status);
    CREATE INDEX IF NOT EXISTS idx_tag_access_requests_date ON tag_access_requests(requested_at DESC);
  `);

  return db;
}

module.exports = {
  initializeDatabase,
};


