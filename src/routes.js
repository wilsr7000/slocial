const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const dayjs = require('dayjs');
const { marked } = require('marked');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const eventTracker = require('./services/eventTracker');
const passport = require('passport');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

// Configure marked
marked.setOptions({
  breaks: true,
  gfm: true,
  headerIds: false,
  mangle: false
});

// Configure multer for memory storage (to store images as blobs in database)
const tagImageUpload = multer({ 
  storage: multer.memoryStorage(), // Store files in memory as Buffer objects
  limits: {
    fileSize: 2 * 1024 * 1024 // 2MB limit (to keep database size reasonable)
  },
  fileFilter: function (req, file, cb) {
    // Accept only image files
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'));
    }
  }
});

function buildRouter(db) {
  const router = express.Router();

  function requireAuth(req, res, next) {
    if (!req.session.user) return res.redirect('/login');
    next();
  }

  function requireAdmin(req, res, next) {
    if (!req.session.user || !req.session.user.is_admin) return res.status(404).send('Not found');
    next();
  }

  // Helper functions for sorts management
  function attachSortsToLetter(letterId, sortIds, userId) {
    if (!sortIds || sortIds.length === 0) return;
    
    // Remove existing sorts for this letter
    db.prepare('DELETE FROM letter_sorts WHERE letter_id = ?').run(letterId);
    
    // Add new sorts
    const insertSort = db.prepare(
      'INSERT INTO letter_sorts (letter_id, sort_id, added_by) VALUES (?, ?, ?)'
    );
    
    for (const sortId of sortIds) {
      try {
        insertSort.run(letterId, sortId, userId);
      } catch (error) {
        console.error(`Failed to attach sort ${sortId} to letter ${letterId}:`, error);
      }
    }
  }
  
  function getLetterSorts(letterId) {
    return db.prepare(`
      SELECT s.* 
      FROM sorts s
      JOIN letter_sorts ls ON s.id = ls.sort_id
      WHERE ls.letter_id = ?
      ORDER BY s.display_order
    `).all(letterId);
  }
  
  function getAllSorts() {
    return db.prepare(`
      SELECT * FROM sorts 
      ORDER BY display_order, name
    `).all();
  }
  
  function parseSortIds(sortsParam) {
    if (!sortsParam) return [];
    if (Array.isArray(sortsParam)) {
      return sortsParam.filter(id => id && !isNaN(id)).map(id => parseInt(id));
    }
    if (typeof sortsParam === 'string') {
      return sortsParam.split(',').filter(id => id && !isNaN(id)).map(id => parseInt(id));
    }
    return [];
  }

  // Reading log helper function
  function logReadingActivity(userId, letterId, action, additionalData = {}) {
    if (!userId || !letterId) return;
    
    try {
      // Get letter details for logging
      const letter = db.prepare(`
        SELECT l.*, u.handle as author_handle 
        FROM letters l 
        JOIN users u ON u.id = l.author_id 
        WHERE l.id = ?
      `).get(letterId);
      
      if (!letter) return;
      
      // Get letter tags
      const tags = getLetterTags(letterId);
      const tagNames = tags.map(t => t.name);
      
      // Calculate word count
      const wordCount = letter.body ? letter.body.split(/\s+/).length : 0;
      
      // Insert log entry
      db.prepare(`
        INSERT INTO reading_log (
          user_id, letter_id, action,
          reading_time_seconds,
          letter_title, letter_author_id, letter_author_handle,
          letter_publish_date, letter_word_count, letter_tags,
          referrer_type, referrer_id, device_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        letterId,
        action,
        additionalData.readingTime || null,
        letter.title,
        letter.author_id,
        letter.author_handle,
        letter.publish_at,
        wordCount,
        JSON.stringify(tagNames),
        additionalData.referrerType || null,
        additionalData.referrerId || null,
        additionalData.deviceType || null
      );
    } catch (error) {
      console.error('Error logging reading activity:', error);
    }
  }

  // Tag management helper functions
  function isTagOwner(userId, tagId) {
    if (!userId) return false;
    
    const ownership = db.prepare(`
      SELECT 1 FROM tag_owners 
      WHERE tag_id = ? AND user_id = ? AND is_active = 1
      LIMIT 1
    `).get(tagId, userId);
    
    return !!ownership;
  }
  
  function isTagFounder(userId, tagId) {
    if (!userId) return false;
    
    const founder = db.prepare(`
      SELECT 1 FROM tag_owners 
      WHERE tag_id = ? AND user_id = ? AND ownership_type = 'founder' AND is_active = 1
      LIMIT 1
    `).get(tagId, userId);
    
    return !!founder;
  }
  
  function getTagOwnership(tagId) {
    return db.prepare(`
      SELECT o.*, u.handle, u.email 
      FROM tag_owners o
      JOIN users u ON o.user_id = u.id
      WHERE o.tag_id = ? AND o.is_active = 1
      ORDER BY o.ownership_type = 'founder' DESC, o.ownership_type = 'owner' DESC, o.granted_at
    `).all(tagId);
  }
  
  function canUserUseTag(userId, tagId) {
    // Owners can always use their tags
    if (isTagOwner(userId, tagId)) return true;
    
    // Check if user has explicit permission or if tag has universal permission (user_id = NULL)
    const permission = db.prepare(`
      SELECT 1 FROM tag_permissions 
      WHERE tag_id = ? 
        AND (user_id = ? OR user_id IS NULL)
        AND permission_type = 'use'
        AND (expires_at IS NULL OR expires_at > datetime('now'))
      LIMIT 1
    `).get(tagId, userId);
    
    return !!permission;
  }
  
  function canUserEditTag(userId, tagId) {
    // Only the founder (creator) can edit the tag
    return isTagFounder(userId, tagId);
  }
  
  function addTagOwner(tagId, newOwnerId, grantedBy, ownershipType = 'co-owner', notes = null) {
    // Check if granter is an owner
    if (!isTagOwner(grantedBy, tagId)) {
      throw new Error('Only tag owners can add new owners');
    }
    
    try {
      // Add new owner
      const result = db.prepare(`
        INSERT INTO tag_owners (tag_id, user_id, ownership_type, granted_by, notes)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(tag_id, user_id) 
        DO UPDATE SET 
          ownership_type = excluded.ownership_type,
          is_active = 1,
          granted_by = excluded.granted_by,
          granted_at = datetime('now'),
          notes = excluded.notes
      `).run(tagId, newOwnerId, ownershipType, grantedBy, notes);
      
      // Record in history
      db.prepare(`
        INSERT INTO tag_ownership_history (tag_id, user_id, action, performed_by, reason, new_type)
        VALUES (?, ?, 'added', ?, ?, ?)
      `).run(tagId, newOwnerId, grantedBy, notes, ownershipType);
      
      // Grant all permissions to new owner
      const permissionTypes = ['use', 'edit', 'delete', 'grant'];
      const grantPermission = db.prepare(`
        INSERT OR IGNORE INTO tag_permissions (tag_id, user_id, permission_type, granted_by)
        VALUES (?, ?, ?, ?)
      `);
      
      for (const permType of permissionTypes) {
        grantPermission.run(tagId, newOwnerId, permType, grantedBy);
      }
      
      return true;
    } catch (error) {
      console.error('Error adding tag owner:', error);
      throw error;
    }
  }
  
  function removeTagOwner(tagId, ownerId, removedBy, reason = null) {
    // Check if remover is an owner
    if (!isTagOwner(removedBy, tagId)) {
      throw new Error('Only tag owners can remove other owners');
    }
    
    // Don't allow removing the last owner
    const ownerCount = db.prepare(`
      SELECT COUNT(*) as count FROM tag_owners 
      WHERE tag_id = ? AND is_active = 1
    `).get(tagId);
    
    if (ownerCount.count <= 1) {
      throw new Error('Cannot remove the last owner of a tag');
    }
    
    // Get current ownership type for history
    const currentOwnership = db.prepare(`
      SELECT ownership_type FROM tag_owners 
      WHERE tag_id = ? AND user_id = ? AND is_active = 1
    `).get(tagId, ownerId);
    
    if (!currentOwnership) {
      throw new Error('User is not an owner of this tag');
    }
    
    // Founders can only be removed by other founders
    if (currentOwnership.ownership_type === 'founder') {
      const removerOwnership = db.prepare(`
        SELECT ownership_type FROM tag_owners 
        WHERE tag_id = ? AND user_id = ? AND is_active = 1
      `).get(tagId, removedBy);
      
      if (removerOwnership.ownership_type !== 'founder') {
        throw new Error('Only founders can remove other founders');
      }
    }
    
    try {
      // Deactivate ownership
      db.prepare(`
        UPDATE tag_owners 
        SET is_active = 0 
        WHERE tag_id = ? AND user_id = ?
      `).run(tagId, ownerId);
      
      // Record in history
      db.prepare(`
        INSERT INTO tag_ownership_history (tag_id, user_id, action, performed_by, reason, previous_type)
        VALUES (?, ?, 'removed', ?, ?, ?)
      `).run(tagId, ownerId, removedBy, reason, currentOwnership.ownership_type);
      
      // Optionally revoke permissions (keeping them for now as they might still need access)
      
      return true;
    } catch (error) {
      console.error('Error removing tag owner:', error);
      throw error;
    }
  }
  
  function transferTagOwnership(tagId, fromUserId, toUserId, reason = null) {
    // Only founders can transfer founder status
    const currentOwnership = db.prepare(`
      SELECT ownership_type FROM tag_owners 
      WHERE tag_id = ? AND user_id = ? AND is_active = 1
    `).get(tagId, fromUserId);
    
    if (!currentOwnership || currentOwnership.ownership_type !== 'founder') {
      throw new Error('Only founders can transfer ownership');
    }
    
    try {
      // Begin transaction
      const transferOwnership = db.transaction(() => {
        // Demote current founder to owner
        db.prepare(`
          UPDATE tag_owners 
          SET ownership_type = 'owner' 
          WHERE tag_id = ? AND user_id = ?
        `).run(tagId, fromUserId);
        
        // Add or promote new founder
        db.prepare(`
          INSERT INTO tag_owners (tag_id, user_id, ownership_type, granted_by, notes)
          VALUES (?, ?, 'founder', ?, ?)
          ON CONFLICT(tag_id, user_id) 
          DO UPDATE SET 
            ownership_type = 'founder',
            is_active = 1,
            granted_by = excluded.granted_by,
            granted_at = datetime('now'),
            notes = excluded.notes
        `).run(tagId, toUserId, fromUserId, reason || 'Ownership transferred');
        
        // Record in history
        db.prepare(`
          INSERT INTO tag_ownership_history (tag_id, user_id, action, performed_by, reason, previous_type, new_type)
          VALUES (?, ?, 'demoted', ?, ?, 'founder', 'owner')
        `).run(tagId, fromUserId, fromUserId, reason);
        
        db.prepare(`
          INSERT INTO tag_ownership_history (tag_id, user_id, action, performed_by, reason, new_type)
          VALUES (?, ?, 'promoted', ?, ?, 'founder')
        `).run(tagId, toUserId, fromUserId, reason);
        
        // Grant all permissions to new founder
        const permissionTypes = ['use', 'edit', 'delete', 'grant'];
        const grantPermission = db.prepare(`
          INSERT OR IGNORE INTO tag_permissions (tag_id, user_id, permission_type, granted_by)
          VALUES (?, ?, ?, ?)
        `);
        
        for (const permType of permissionTypes) {
          grantPermission.run(tagId, toUserId, permType, fromUserId);
        }
      });
      
      transferOwnership();
      return true;
    } catch (error) {
      console.error('Error transferring tag ownership:', error);
      throw error;
    }
  }
  
  function getUserAvailableTags(userId) {
    // Get all tags the user can use (created by them, public, or explicitly permitted)
    return db.prepare(`
      SELECT DISTINCT t.* 
      FROM tags t
      LEFT JOIN tag_permissions tp ON t.id = tp.tag_id
      WHERE t.is_active = 1
        AND (
          t.created_by = ? 
          OR t.is_public = 1
          OR (tp.user_id = ? AND tp.permission_type = 'use' 
              AND (tp.expires_at IS NULL OR tp.expires_at > datetime('now')))
          OR (tp.user_id IS NULL AND tp.permission_type = 'use'
              AND (tp.expires_at IS NULL OR tp.expires_at > datetime('now')))
        )
      ORDER BY t.usage_count DESC, t.name
    `).all(userId, userId);
  }
  
  function attachTagsToLetter(letterId, tagIds, userId) {
    if (!tagIds || tagIds.length === 0) return;
    
    // Verify user can use all requested tags
    const validTagIds = [];
    for (const tagId of tagIds) {
      if (canUserUseTag(userId, tagId)) {
        validTagIds.push(tagId);
      } else {
        console.log(`User ${userId} cannot use tag ${tagId}`);
      }
    }
    
    if (validTagIds.length === 0) return;
    
    // Remove existing tags for this letter
    db.prepare('DELETE FROM letter_tags WHERE letter_id = ?').run(letterId);
    
    // Add new tags
    const insertTag = db.prepare(
      'INSERT INTO letter_tags (letter_id, tag_id, added_by) VALUES (?, ?, ?)'
    );
    
    const updateUsageCount = db.prepare(
      'UPDATE tags SET usage_count = usage_count + 1, updated_at = datetime("now") WHERE id = ?'
    );
    
    for (const tagId of validTagIds) {
      try {
        insertTag.run(letterId, tagId, userId);
        updateUsageCount.run(tagId);
      } catch (error) {
        console.error(`Failed to attach tag ${tagId} to letter ${letterId}:`, error);
      }
    }
  }
  
  function getLetterTags(letterId) {
    return db.prepare(`
      SELECT t.* 
      FROM tags t
      JOIN letter_tags lt ON t.id = lt.tag_id
      WHERE lt.letter_id = ? AND t.is_active = 1
      ORDER BY t.name
    `).all(letterId);
  }
  
  function createTag(name, description, userId, isPublic = true) {
    // Generate slug from name
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    
    try {
      const createTagTransaction = db.transaction(() => {
        // Create the tag
        const result = db.prepare(`
          INSERT INTO tags (name, slug, description, created_by, is_public)
          VALUES (?, ?, ?, ?, ?)
        `).run(name, slug, description, userId, isPublic ? 1 : 0);
        
        const tagId = result.lastInsertRowid;
        
        // Make the creator the founder/owner
        db.prepare(`
          INSERT INTO tag_owners (tag_id, user_id, ownership_type, granted_by, notes)
          VALUES (?, ?, 'founder', ?, 'Original creator')
        `).run(tagId, userId, userId);
        
        // Record in ownership history
        db.prepare(`
          INSERT INTO tag_ownership_history (tag_id, user_id, action, performed_by, reason, new_type)
          VALUES (?, ?, 'added', ?, 'Tag created', 'founder')
        `).run(tagId, userId, userId);
        
        // Grant all permissions to creator
        const permissionTypes = ['use', 'edit', 'delete', 'grant'];
        const grantPermission = db.prepare(`
          INSERT INTO tag_permissions (tag_id, user_id, permission_type, granted_by)
          VALUES (?, ?, ?, ?)
        `);
        
        for (const permType of permissionTypes) {
          grantPermission.run(tagId, userId, permType, userId);
        }
        
        // If public, grant use permission to all users (NULL user_id)
        if (isPublic) {
          db.prepare(`
            INSERT INTO tag_permissions (tag_id, user_id, permission_type, granted_by)
            VALUES (?, NULL, 'use', ?)
          `).run(tagId, userId);
        }
        
        return tagId;
      });
      
      const tagId = createTagTransaction();
      return { id: tagId, name, slug, description, is_public: isPublic };
    } catch (error) {
      if (error.message.includes('UNIQUE constraint failed')) {
        throw new Error('A tag with this name already exists');
      }
      throw error;
    }
  }
  
  function searchTags(query, userId) {
    // Search for tags by name or description that the user can access
    return db.prepare(`
      SELECT DISTINCT t.* 
      FROM tags t
      LEFT JOIN tag_permissions tp ON t.id = tp.tag_id
      WHERE t.is_active = 1
        AND (t.name LIKE ? OR t.description LIKE ?)
        AND (
          t.created_by = ? 
          OR t.is_public = 1
          OR (tp.user_id = ? AND tp.permission_type = 'use' 
              AND (tp.expires_at IS NULL OR tp.expires_at > datetime('now')))
          OR (tp.user_id IS NULL AND tp.permission_type = 'use'
              AND (tp.expires_at IS NULL OR tp.expires_at > datetime('now')))
        )
      ORDER BY t.usage_count DESC, t.name
      LIMIT 20
    `).all(`%${query}%`, `%${query}%`, userId, userId);
  }
  
  function getPopularTags(limit = 20) {
    return db.prepare(`
      SELECT * FROM tags 
      WHERE is_active = 1 AND is_public = 1
      ORDER BY usage_count DESC, name
      LIMIT ?
    `).all(limit);
  }
  
  function parseTagIds(tagsParam) {
    if (!tagsParam) return [];
    if (Array.isArray(tagsParam)) {
      return tagsParam.filter(id => id && !isNaN(id)).map(id => parseInt(id));
    }
    if (typeof tagsParam === 'string') {
      return tagsParam.split(',').filter(id => id && !isNaN(id)).map(id => parseInt(id));
    }
    return [];
  }
  
  // Check if a user can view a letter based on tag permissions
  function canUserViewLetter(userId, letterId) {
    // Admin can see everything
    if (userId) {
      const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId);
      if (user && user.is_admin) return true;
      
      // Author can see their own letters
      const letter = db.prepare('SELECT author_id FROM letters WHERE id = ?').get(letterId);
      if (letter && letter.author_id === userId) return true;
      
      // Logged-in users: Check if user has permission to view at least one tag on the letter
      const hasPermission = db.prepare(`
        SELECT 1 
        FROM letter_tags lt
        JOIN tags t ON lt.tag_id = t.id
        LEFT JOIN tag_permissions tp ON t.id = tp.tag_id
        WHERE lt.letter_id = ?
          AND t.is_active = 1
          AND (
            -- Public tags with universal permission
            (tp.user_id IS NULL AND tp.permission_type = 'use' 
             AND (tp.expires_at IS NULL OR tp.expires_at > datetime('now')))
            -- User-specific permission
            OR (tp.user_id = ? AND tp.permission_type = 'use'
                AND (tp.expires_at IS NULL OR tp.expires_at > datetime('now')))
          )
        LIMIT 1
      `).get(letterId, userId);
      
      return !!hasPermission;
    } else {
      // Non-logged-in users can ONLY see letters tagged with "public"
      const hasPublicTag = db.prepare(`
        SELECT 1 
        FROM letter_tags lt
        JOIN tags t ON lt.tag_id = t.id
        WHERE lt.letter_id = ?
          AND t.slug = 'public'
          AND t.is_active = 1
        LIMIT 1
      `).get(letterId);
      
      return !!hasPublicTag;
    }
  }
  
  // Generate WHERE clause for tag-based visibility
  function getTagVisibilityCondition(userId, tableAlias = 'l') {
    if (!userId) {
      // Non-logged in users can ONLY see letters tagged with "public"
      return `
        EXISTS (
          SELECT 1 FROM letter_tags lt
          JOIN tags t ON lt.tag_id = t.id
          WHERE lt.letter_id = ${tableAlias}.id
            AND t.slug = 'public'
            AND t.is_active = 1
        )
      `;
    }
    
    // Logged in users can see letters where they have permission to at least one tag
    return `
      (
        ${tableAlias}.author_id = ${userId}  -- User's own letters
        OR EXISTS (
          SELECT 1 FROM users WHERE id = ${userId} AND is_admin = 1
        )  -- Admin can see all
        OR EXISTS (
          SELECT 1 FROM letter_tags lt
          JOIN tags t ON lt.tag_id = t.id
          LEFT JOIN tag_permissions tp ON t.id = tp.tag_id
          WHERE lt.letter_id = ${tableAlias}.id
            AND t.is_active = 1
            AND (
              (tp.user_id IS NULL AND tp.permission_type = 'use' 
               AND (tp.expires_at IS NULL OR tp.expires_at > datetime('now')))
              OR (tp.user_id = ${userId} AND tp.permission_type = 'use'
                  AND (tp.expires_at IS NULL OR tp.expires_at > datetime('now')))
            )
        )
      )
    `;
  }

  function renderMarkdown(text) {
    const html = marked.parse(text);
    // Allow data URLs for embedded images
    return DOMPurify.sanitize(html, {
      ADD_DATA_URI_TAGS: ['img'],
      ADD_ATTR: ['target']
    });
  }

  router.get('/', (req, res) => {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = 10;
    const offset = (page - 1) * pageSize;
    const now = dayjs().toISOString();
    const userId = req.session.user?.id || null;
    const filterTag = req.query.filter || null;
    
    // Check if is_draft and approval_status columns exist
    let hasDraftColumn = false;
    let hasApprovalColumn = false;
    try {
      const columns = db.prepare("PRAGMA table_info(letters)").all();
      hasDraftColumn = columns.some(col => col.name === 'is_draft');
      hasApprovalColumn = columns.some(col => col.name === 'approval_status');
    } catch (e) {
      console.error('Error checking for columns:', e);
    }
    
    // Build tag visibility condition
    const tagVisibilityCondition = getTagVisibilityCondition(userId, 'l');
    
    // Build tag filter condition if filtering by tag
    let tagFilterCondition = '';
    let filterTagData = null;
    if (filterTag) {
      // Get the tag data to display
      filterTagData = db.prepare('SELECT * FROM tags WHERE name = ? COLLATE NOCASE AND is_active = 1').get(filterTag);
      if (filterTagData) {
        tagFilterCondition = `AND EXISTS (
          SELECT 1 FROM letter_tags lt 
          WHERE lt.letter_id = l.id AND lt.tag_id = @tagId
        )`;
      }
    }
    
    // Use appropriate query based on available columns - now with tag filtering
    const query = hasApprovalColumn ? `
      SELECT l.*, u.handle, u.bio, u.avatar_url, u.is_slocialite,
        (SELECT COUNT(1) FROM resonates r WHERE r.letter_id = l.id) AS resonate_count,
        EXISTS(SELECT 1 FROM resonates r WHERE r.letter_id = l.id AND r.user_id = @uid) AS did_resonate,
        rs.status AS reading_status
      FROM letters l
      JOIN users u ON u.id = l.author_id
      LEFT JOIN reading_status rs ON rs.letter_id = l.id AND rs.user_id = @uid
      WHERE l.is_published = 1 ${hasDraftColumn ? 'AND l.is_draft = 0' : ''} 
        AND l.publish_at <= @now
        AND (l.approval_status = 'approved' OR l.approval_status IS NULL)
        AND ${tagVisibilityCondition}
        ${tagFilterCondition}
      ORDER BY l.publish_at DESC
      LIMIT @limit OFFSET @offset
    ` : hasDraftColumn ? `
      SELECT l.*, u.handle, u.bio, u.avatar_url, u.is_slocialite,
        (SELECT COUNT(1) FROM resonates r WHERE r.letter_id = l.id) AS resonate_count,
        EXISTS(SELECT 1 FROM resonates r WHERE r.letter_id = l.id AND r.user_id = @uid) AS did_resonate,
        rs.status AS reading_status
      FROM letters l
      JOIN users u ON u.id = l.author_id
      LEFT JOIN reading_status rs ON rs.letter_id = l.id AND rs.user_id = @uid
      WHERE l.is_published = 1 AND l.is_draft = 0 AND l.publish_at <= @now
        AND ${tagVisibilityCondition}
        ${tagFilterCondition}
      ORDER BY l.publish_at DESC
      LIMIT @limit OFFSET @offset
    ` : `
      SELECT l.*, u.handle, u.bio, u.avatar_url, u.is_slocialite,
        (SELECT COUNT(1) FROM resonates r WHERE r.letter_id = l.id) AS resonate_count,
        EXISTS(SELECT 1 FROM resonates r WHERE r.letter_id = l.id AND r.user_id = @uid) AS did_resonate,
        rs.status AS reading_status
      FROM letters l
      JOIN users u ON u.id = l.author_id
      LEFT JOIN reading_status rs ON rs.letter_id = l.id AND rs.user_id = @uid
      WHERE l.is_published = 1 AND l.publish_at <= @now
        AND ${tagVisibilityCondition}
        ${tagFilterCondition}
      ORDER BY l.publish_at DESC
      LIMIT @limit OFFSET @offset
    `;
    
    const params = { now, limit: pageSize, offset, uid: userId || -1 };
    if (filterTagData) {
      params.tagId = filterTagData.id;
    }
    const letters = db.prepare(query).all(params);
    
    // Add tags to each letter for display
    letters.forEach(letter => {
      letter.tags = getLetterTags(letter.id);
    });

    res.render('index', { 
      user: req.session.user, 
      letters, 
      page, 
      pageClass: 'home',
      filterTag: filterTagData,
      pageTitle: 'Slocial - Read'
    });
  });

  router.get('/about', (req, res) => {
    res.render('about', { 
      user: req.session.user,
      pageTitle: 'Slocial - About this project'
    });
  });
  
  // Test endpoint to verify deployment
  router.get('/test-deploy', (req, res) => {
    res.json({ 
      message: 'Admin routes deployed', 
      version: 'v2',
      hasAdmin: req.session.user?.is_admin || false,
      user: req.session.user?.email || 'not logged in'
    });
  });

  // API endpoint for infinite scroll
  router.get('/api/letters', (req, res) => {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = 10;
    const offset = (page - 1) * pageSize;
    const now = dayjs().toISOString();
    const userId = req.session.user?.id || null;
    const filterTag = req.query.filter || null;
    
    // Check if is_draft column exists
    let hasDraftColumn = false;
    try {
      const columns = db.prepare("PRAGMA table_info(letters)").all();
      hasDraftColumn = columns.some(col => col.name === 'is_draft');
    } catch (e) {
      console.error('Error checking for is_draft column:', e);
    }
    
    // Build tag visibility condition
    const tagVisibilityCondition = getTagVisibilityCondition(userId, 'l');
    
    // Build tag filter condition if filtering by tag
    let tagFilterCondition = '';
    let filterTagData = null;
    if (filterTag) {
      // Get the tag data to display
      filterTagData = db.prepare('SELECT * FROM tags WHERE name = ? COLLATE NOCASE AND is_active = 1').get(filterTag);
      if (filterTagData) {
        tagFilterCondition = `AND EXISTS (
          SELECT 1 FROM letter_tags lt 
          WHERE lt.letter_id = l.id AND lt.tag_id = @tagId
        )`;
      }
    }
    
    // Use appropriate query based on whether draft column exists - now with tag filtering
    const query = hasDraftColumn ? `
      SELECT l.*, u.handle, u.bio, u.avatar_url, u.is_slocialite,
        (SELECT COUNT(1) FROM resonates r WHERE r.letter_id = l.id) AS resonate_count,
        EXISTS(SELECT 1 FROM resonates r WHERE r.letter_id = l.id AND r.user_id = @uid) AS did_resonate,
        rs.status AS reading_status
      FROM letters l
      JOIN users u ON u.id = l.author_id
      LEFT JOIN reading_status rs ON rs.letter_id = l.id AND rs.user_id = @uid
      WHERE l.is_published = 1 AND l.is_draft = 0 AND l.publish_at <= @now
        AND ${tagVisibilityCondition}
        ${tagFilterCondition}
      ORDER BY l.publish_at DESC
      LIMIT @limit OFFSET @offset
    ` : `
      SELECT l.*, u.handle, u.bio, u.avatar_url, u.is_slocialite,
        (SELECT COUNT(1) FROM resonates r WHERE r.letter_id = l.id) AS resonate_count,
        EXISTS(SELECT 1 FROM resonates r WHERE r.letter_id = l.id AND r.user_id = @uid) AS did_resonate,
        rs.status AS reading_status
      FROM letters l
      JOIN users u ON u.id = l.author_id
      LEFT JOIN reading_status rs ON rs.letter_id = l.id AND rs.user_id = @uid
      WHERE l.is_published = 1 AND l.publish_at <= @now
        AND ${tagVisibilityCondition}
        ${tagFilterCondition}
      ORDER BY l.publish_at DESC
      LIMIT @limit OFFSET @offset
    `;
    
    const params = { now, limit: pageSize, offset, uid: userId || -1 };
    if (filterTagData) {
      params.tagId = filterTagData.id;
    }
    const letters = db.prepare(query).all(params);
    
    // Add tags to each letter for display
    letters.forEach(letter => {
      letter.tags = getLetterTags(letter.id);
    });
    
    // Check if there are more letters (also needs tag filtering for accurate count)
    const countQuery = hasDraftColumn ? 
      `SELECT COUNT(DISTINCT l.id) as total FROM letters l 
       WHERE l.is_published = 1 AND l.is_draft = 0 AND l.publish_at <= @now 
       AND ${tagVisibilityCondition} ${tagFilterCondition}` :
      `SELECT COUNT(DISTINCT l.id) as total FROM letters l 
       WHERE l.is_published = 1 AND l.publish_at <= @now 
       AND ${tagVisibilityCondition} ${tagFilterCondition}`;
    const countParams = { now };
    if (filterTagData) {
      countParams.tagId = filterTagData.id;
    }
    const totalCount = db.prepare(countQuery).get(countParams).total;
    const hasMore = offset + letters.length < totalCount;
    
    // Format letters for API response
    const formattedLetters = letters.map(letter => ({
      ...letter,
      body_html: renderMarkdown(letter.body),
      publish_at_formatted: dayjs(letter.publish_at).fromNow(),
      is_user_logged_in: !!req.session.user,
      csrfToken: req.csrfToken()
    }));
    
    res.json({
      letters: formattedLetters,
      hasMore,
      page,
      total: totalCount
    });
  });
  
  // API endpoint for auto-saving drafts
  router.post('/api/draft', requireAuth, (req, res) => {
    const { id, title, body } = req.body;
    const userId = req.session.user.id;
    const now = dayjs().toISOString();
    
    try {
      let draftId = id;
      
      if (draftId) {
        // Update existing draft
        const draft = db.prepare('SELECT * FROM letters WHERE id = ? AND author_id = ? AND is_draft = 1')
          .get(draftId, userId);
        
        if (draft) {
          db.prepare('UPDATE letters SET title = ?, body = ?, last_saved_at = ? WHERE id = ?')
            .run(title, body, now, draftId);
        } else {
          // Draft not found or doesn't belong to user, create new one
          draftId = null;
        }
      }
      
      if (!draftId) {
        // Create new draft
        const result = db.prepare('INSERT INTO letters (author_id, title, body, format, is_draft, last_saved_at, created_at, publish_at, is_published) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 0)')
          .run(userId, title, body, 'standard', now, now, now, 0);
        draftId = result.lastInsertRowid;
      }
      
      res.json({ success: true, draftId });
    } catch (error) {
      console.error('Error saving draft:', error);
      res.status(500).json({ success: false, error: 'Failed to save draft' });
    }
  });
  
  router.get('/principles', (req, res) => {
    res.render('principles', { user: req.session.user });
  });

  router.get('/signup', (req, res) => res.render('signup', { 
    user: req.session.user, 
    errors: [], 
    values: {}, 
    pageClass: 'auth',
    theme: req.cookies?.theme || 'light',
    pageTitle: 'Slocial - Sign Up'
  }));
  router.post('/signup',
    body('handle').isLength({ min: 3, max: 20 }).isAlphanumeric().withMessage('Handle must be alphanumeric 3-20'),
    body('email').isEmail(),
    body('password').isLength({ min: 8 }),
    (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).render('signup', { user: req.session.user, errors: errors.array(), values: req.body, pageClass: 'auth' });
      }
      const { handle, email, password } = req.body;
      const password_hash = bcrypt.hashSync(password, 12);
      try {
        // Check if is_slocialite column exists
        let hasSlocialiteColumn = false;
        try {
          const columns = db.prepare("PRAGMA table_info(users)").all();
          hasSlocialiteColumn = columns.some(col => col.name === 'is_slocialite');
        } catch (e) {
          // Column might not exist yet
        }
        
        // New users are Slocialites by default (need moderation)
        const info = hasSlocialiteColumn ?
          db.prepare('INSERT INTO users (handle, email, password_hash, is_slocialite) VALUES (?, ?, ?, 1)').run(handle, email, password_hash) :
          db.prepare('INSERT INTO users (handle, email, password_hash) VALUES (?, ?, ?)').run(handle, email, password_hash);
        
        const newUserId = info.lastInsertRowid;
        
        // Grant permission to use the public tag for all new users
        try {
          db.prepare(`
            INSERT INTO tag_permissions (tag_id, user_id, permission_type, granted_by)
            SELECT id, ?, 'use', ?
            FROM tags WHERE slug = 'public'
          `).run(newUserId, newUserId);
        } catch (e) {
          console.error('Failed to grant public tag permission:', e);
          // Non-fatal error, continue with signup
        }
        
        req.session.user = { id: newUserId, handle, email, is_admin: false, is_slocialite: hasSlocialiteColumn ? true : false };
      eventTracker.track('signup', {
        userId: newUserId,
        sessionId: req.sessionID,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        metadata: { handle, email }
      });
      res.redirect('/');
      } catch (e) {
        const msg = /UNIQUE/.test(e.message) ? 'Handle or email already taken' : 'Signup failed';
        res.status(400).render('signup', { user: req.session.user, errors: [{ msg }], values: req.body, pageClass: 'auth' });
      }
    }
  );

  router.get('/login', (req, res) => res.render('login', { 
    user: req.session.user, 
    errors: [], 
    values: {}, 
    pageClass: 'auth',
    theme: req.cookies?.theme || 'light',
    pageTitle: 'Slocial - Sign In'
  }));
  router.post('/login',
    body('email').isEmail(),
    body('password').isLength({ min: 8 }),
    (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).render('login', { user: req.session.user, errors: errors.array(), values: req.body, pageClass: 'auth' });
      const { email, password } = req.body;
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        return res.status(401).render('login', { user: req.session.user, errors: [{ msg: 'Invalid credentials' }], values: req.body, pageClass: 'auth' });
      }
      req.session.user = { id: user.id, handle: user.handle, email: user.email, is_admin: user.is_admin === 1 };
      eventTracker.track('login', {
        userId: user.id,
        sessionId: req.sessionID,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        metadata: { handle: user.handle }
      });
      res.redirect('/');
    }
  );

  router.post('/logout', (req, res) => {
    const userId = req.session.user?.id;
    eventTracker.track('logout', {
      userId,
      sessionId: req.sessionID,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });
    req.logout(() => {
      req.session.destroy(() => res.redirect('/'));
    });
  });

  // OAuth Routes - Google
  router.get('/auth/google', 
    passport.authenticate('google', { scope: ['profile', 'email'] })
  );

  router.get('/auth/google/callback',
    passport.authenticate('google', { 
      failureRedirect: '/login',
      failureFlash: false 
    }),
    (req, res, next) => {
      if (!req.user) {
        console.error('Google OAuth: No user after authentication');
        return res.status(500).send('Authentication failed - no user');
      }
      // Set session user data
      req.session.user = {
        id: req.user.id,
        handle: req.user.handle,
        email: req.user.email,
        is_admin: req.user.is_admin === 1
      };
      
      eventTracker.track('login', {
        userId: req.user.id,
        sessionId: req.sessionID,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        metadata: { provider: 'google', handle: req.user.handle }
      });
      
      res.redirect('/');
    }
  );

  // OAuth Routes - Apple
  router.get('/auth/apple',
    passport.authenticate('apple')
  );

  router.post('/auth/apple/callback',
    passport.authenticate('apple', { 
      failureRedirect: '/login',
      failureFlash: false 
    }),
    (req, res, next) => {
      if (!req.user) {
        console.error('Apple OAuth: No user after authentication');
        return res.status(500).send('Authentication failed - no user');
      }
      // Set session user data
      req.session.user = {
        id: req.user.id,
        handle: req.user.handle,
        email: req.user.email,
        is_admin: req.user.is_admin === 1
      };
      
      eventTracker.track('login', {
        userId: req.user.id,
        sessionId: req.sessionID,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        metadata: { provider: 'apple', handle: req.user.handle }
      });
      
      res.redirect('/');
    }
  );

  // Profile routes
  router.get('/profile', requireAuth, (req, res) => {
    const userId = req.session.user.id;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    
    // Get reading log stats
    let readingStats = null;
    try {
      const totalEntries = db.prepare('SELECT COUNT(*) as count FROM reading_log WHERE user_id = ?').get(userId);
      const uniqueLetters = db.prepare('SELECT COUNT(DISTINCT letter_id) as count FROM reading_log WHERE user_id = ?').get(userId);
      const totalReadingTime = db.prepare('SELECT SUM(reading_time_seconds) as total FROM reading_log WHERE user_id = ? AND reading_time_seconds IS NOT NULL').get(userId);
      const actionCounts = db.prepare(`
        SELECT action, COUNT(*) as count 
        FROM reading_log 
        WHERE user_id = ? 
        GROUP BY action
      `).all(userId);
      
      readingStats = {
        totalEntries: totalEntries?.count || 0,
        uniqueLetters: uniqueLetters?.count || 0,
        totalReadingTime: totalReadingTime?.total || 0,
        actionCounts: actionCounts || []
      };
    } catch (error) {
      console.error('Error fetching reading stats:', error);
    }
    
    res.render('profile', { 
      user: req.session.user, 
      profile: user, 
      errors: [], 
      isAuthor: user.is_slocialite === 0,
      readingStats,
      pageTitle: 'Slocial - Profile' 
    });
  });

  router.post('/profile', requireAuth,
    body('bio').isLength({ max: 500 }).withMessage('Bio must be under 500 characters'),
    body('avatar_url').optional({ checkFalsy: true }).isURL().withMessage('Avatar must be a valid URL'),
    (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
        return res.status(400).render('profile', { user: req.session.user, profile: user, errors: errors.array() });
      }

      const { bio, avatar_url } = req.body;
      db.prepare('UPDATE users SET bio = ?, avatar_url = ? WHERE id = ?')
        .run(bio || null, avatar_url || null, req.session.user.id);
      
      res.redirect('/profile?saved=1');
    }
  );
  
  // Download reading log as CSV
  router.get('/profile/reading-log/download', requireAuth, (req, res) => {
    const userId = req.session.user.id;
    
    // Get all reading log entries for this user
    const logs = db.prepare(`
      SELECT 
        rl.*,
        l.title as current_title,
        u.handle as current_author_handle
      FROM reading_log rl
      LEFT JOIN letters l ON l.id = rl.letter_id
      LEFT JOIN users u ON u.id = rl.letter_author_id
      WHERE rl.user_id = ?
      ORDER BY rl.created_at DESC
    `).all(userId);
    
    // Create CSV content
    const csvHeaders = [
      'Date',
      'Action',
      'Letter Title',
      'Author',
      'Reading Time (seconds)',
      'Word Count',
      'Tags',
      'Source'
    ];
    
    const csvRows = logs.map(log => {
      const date = new Date(log.created_at).toISOString().split('T')[0];
      const tags = log.letter_tags ? JSON.parse(log.letter_tags).join(', ') : '';
      const source = log.referrer_type || 'unknown';
      
      return [
        date,
        log.action,
        log.letter_title || log.current_title || 'Unknown',
        log.letter_author_handle || log.current_author_handle || 'Unknown',
        log.reading_time_seconds || '0',
        log.letter_word_count || '0',
        tags,
        source
      ].map(field => {
        // Escape fields that contain commas or quotes
        const str = String(field);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(',');
    });
    
    const csv = [csvHeaders.join(','), ...csvRows].join('\n');
    
    // Send CSV file
    const filename = `slocial-reading-log-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  });
  
  // Delete reading log
  router.post('/profile/reading-log/delete', requireAuth, (req, res) => {
    const userId = req.session.user.id;
    
    try {
      // Delete all reading log entries for this user
      const result = db.prepare('DELETE FROM reading_log WHERE user_id = ?').run(userId);
      
      // Track the deletion event
      eventTracker.track('reading_log_deleted', {
        userId,
        sessionId: req.sessionID,
        metadata: { 
          entries_deleted: result.changes 
        }
      });
      
      res.redirect('/profile?deleted=1');
    } catch (error) {
      console.error('Error deleting reading log:', error);
      res.redirect('/profile?error=1');
    }
  });

  router.get('/compose', requireAuth, (req, res) => {
    res.render('compose', { 
      user: req.session.user, 
      errors: [], 
      values: {}, 
      pageClass: 'compose',
      theme: req.cookies?.theme || 'light',
      pageTitle: 'Slocial - Compose'
    });
  });
  
  // Drafts routes
  router.get('/drafts', requireAuth, (req, res) => {
    // Temporarily show unpublished letters with future dates as drafts
    const drafts = db.prepare(`
      SELECT * FROM letters 
      WHERE author_id = ? 
        AND is_published = 0 
        AND publish_at > datetime('now', '+12 hours')
      ORDER BY created_at DESC
    `).all(req.session.user.id);
    
    const saved = req.query.saved;
    res.render('drafts', { 
      user: req.session.user, 
      drafts, 
      saved: !!saved,
      pageTitle: 'Slocial - Drafts' 
    });
  });
  
  // Publish draft directly from drafts page
  router.post('/drafts/:id/publish', requireAuth, (req, res) => {
    const draftId = req.params.id;
    const now = dayjs();
    
    // Verify ownership (temporarily check unpublished letters)
    const draft = db.prepare(`
      SELECT * FROM letters 
      WHERE id = ? 
        AND author_id = ? 
        AND is_published = 0
    `).get(draftId, req.session.user.id);
    
    if (!draft) {
      return res.status(404).send('Draft not found');
    }
    
    // Check 24-hour limit (honor system - just log for now)
    const lastPublished = db.prepare('SELECT created_at FROM letters WHERE author_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(req.session.user.id);
    
    if (lastPublished && dayjs(lastPublished.created_at).isAfter(now.subtract(24, 'hour'))) {
      // Just log it - honor system
      console.log(`User ${req.session.user.id} publishing within 24 hours (honor system)`);
    }
    
    // Convert draft to published letter
    const publish_at = now.add(12, 'hour').toISOString();
    db.prepare(`
      UPDATE letters 
      SET publish_at = ?
      WHERE id = ?
    `).run(publish_at, draftId);
    
    eventTracker.track('draft_publish', {
      userId: req.session.user.id,
      sessionId: req.sessionID,
      letterId: draftId,
      metadata: { title: draft.title.slice(0, 50) }
    });
    
    res.redirect(`/letters/${draftId}`);
  });
  
  // Tags browsing and access request routes
  router.get('/tags', (req, res) => {
    const userId = req.session.user?.id;
    
    // Get all active tags with stats
    const tags = db.prepare(`
      SELECT 
        t.*,
        COUNT(DISTINCT lt.letter_id) as letter_count,
        COUNT(DISTINCT o.user_id) as owner_count,
        CASE 
          WHEN tp.user_id IS NOT NULL OR tpu.user_id IS NULL THEN 1
          ELSE 0
        END as has_access,
        CASE
          WHEN o.user_id IS NOT NULL THEN 1
          ELSE 0
        END as is_owner,
        tar.status as request_status,
        CASE
          WHEN o.user_id IS NOT NULL THEN (
            SELECT COUNT(*) FROM tag_access_requests 
            WHERE tag_id = t.id AND status = 'pending'
          )
          ELSE 0
        END as pending_request_count
      FROM tags t
      LEFT JOIN letter_tags lt ON t.id = lt.tag_id
      LEFT JOIN tag_owners o ON t.id = o.tag_id AND o.is_active = 1 AND o.user_id = ?
      LEFT JOIN tag_permissions tp ON t.id = tp.tag_id 
        AND tp.user_id = ? 
        AND tp.permission_type = 'use'
        AND (tp.expires_at IS NULL OR tp.expires_at > datetime('now'))
      LEFT JOIN tag_permissions tpu ON t.id = tpu.tag_id 
        AND tpu.user_id IS NULL 
        AND tpu.permission_type = 'use'
      LEFT JOIN tag_access_requests tar ON t.id = tar.tag_id 
        AND tar.user_id = ?
      WHERE t.is_active = 1
      GROUP BY t.id
      ORDER BY t.usage_count DESC, t.name
    `).all(userId || -1, userId || -1, userId || -1);
    
    // Get tag owners for each tag
    const tagOwnersQuery = db.prepare(`
      SELECT 
        o.tag_id,
        u.handle,
        u.id as user_id,
        o.ownership_type
      FROM tag_owners o
      JOIN users u ON o.user_id = u.id
      WHERE o.is_active = 1
      ORDER BY o.ownership_type = 'founder' DESC, o.ownership_type = 'owner' DESC
    `);
    
    const allOwners = tagOwnersQuery.all();
    
    // Group owners by tag
    const ownersByTag = {};
    for (const owner of allOwners) {
      if (!ownersByTag[owner.tag_id]) {
        ownersByTag[owner.tag_id] = [];
      }
      ownersByTag[owner.tag_id].push(owner);
    }
    
    // Add owners to each tag
    tags.forEach(tag => {
      tag.owners = ownersByTag[tag.id] || [];
    });
    
    res.render('tags', { 
      user: req.session.user, 
      tags,
      message: req.query.message,
      error: req.query.error,
      csrfToken: req.csrfToken(),
      pageTitle: 'Slocial - Mosaics'
    });
  });
  
  // Create a new tag
  router.post('/tags/create', requireAuth, tagImageUpload.single('image_file'), (req, res) => {
    const { name, short_description, long_description, image_url, is_public, auto_approve } = req.body;
    const userId = req.session.user.id;
    
    // Validate required fields
    if (!name || !short_description) {
      return res.redirect('/tags?error=' + encodeURIComponent('Tag name and short description are required'));
    }
    
    // Create slug from name
    const slug = name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    
    // Handle image data
    let imageData = null;
    let finalImageUrl = null;
    
    if (req.file) {
      // If file was uploaded, store it as a blob
      imageData = req.file.buffer;
      // Set a special URL that will be served from database
      finalImageUrl = `/api/tags/${slug}/image`;
    } else if (image_url) {
      // Otherwise use the provided URL if any
      finalImageUrl = image_url;
    }
    
    try {
      // Begin transaction
      db.prepare('BEGIN').run();
      
      // Check if tag with same name already exists (case-insensitive)
      const existing = db.prepare(`
        SELECT id FROM tags WHERE name COLLATE NOCASE = ?
      `).get(name);
      
      if (existing) {
        db.prepare('ROLLBACK').run();
        return res.redirect('/tags?error=' + encodeURIComponent('A tag with this name already exists'));
      }
      
      // Create the tag
      const result = db.prepare(`
        INSERT INTO tags (name, slug, description, short_description, long_description, image_url, image_data, created_by, is_public, auto_approve)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        name,
        slug,
        short_description, // Use short_description for the main description field
        short_description,
        long_description || null,
        finalImageUrl,
        imageData,
        userId,
        is_public ? 1 : 0,
        auto_approve ? 1 : 0
      );
      
      const tagId = result.lastInsertRowid;
      
      // Add creator as founder/owner
      db.prepare(`
        INSERT INTO tag_owners (tag_id, user_id, ownership_type, granted_by)
        VALUES (?, ?, 'founder', ?)
      `).run(tagId, userId, userId);
      
      // Grant creator 'use' permission (edit is implicit for founder)
      db.prepare(`
        INSERT INTO tag_permissions (tag_id, user_id, permission_type, granted_by)
        VALUES (?, ?, 'use', ?)
      `).run(tagId, userId, userId);
      
      // Commit transaction
      db.prepare('COMMIT').run();
      
      res.redirect('/tags?message=' + encodeURIComponent('Tag created successfully!'));
      
    } catch (error) {
      db.prepare('ROLLBACK').run();
      console.error('Error creating tag:', error);
      // Delete uploaded file if it exists
      if (req.file) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          console.error('Failed to delete uploaded file:', e);
        }
      }
      res.redirect('/tags?error=' + encodeURIComponent('Failed to create tag'));
    }
  });
  
  // Request access to a tag
  router.post('/tags/:id/request-access', requireAuth, (req, res) => {
    const tagId = req.params.id;
    const userId = req.session.user.id;
    const { message } = req.body;
    
    // Check if user already has access
    if (canUserUseTag(userId, tagId)) {
      return res.redirect('/tags?error=' + encodeURIComponent('You already have access to this tag'));
    }
    
    // Get tag info including auto_approve setting
    const tag = db.prepare('SELECT name, auto_approve FROM tags WHERE id = ?').get(tagId);
    
    if (!tag) {
      return res.redirect('/tags?error=' + encodeURIComponent('Tag not found'));
    }
    
    try {
      if (tag.auto_approve) {
        // Auto-approve is enabled - grant access immediately
        db.prepare(`
          INSERT INTO tag_permissions (tag_id, user_id, permission_type, granted_by)
          VALUES (?, ?, 'use', ?)
        `).run(tagId, userId, userId); // Self-granted through auto-approve
        
        // Record the request as auto-approved
        db.prepare(`
          INSERT INTO tag_access_requests (tag_id, user_id, request_message, status, response_message, responded_at, responded_by)
          VALUES (?, ?, ?, 'approved', 'Auto-approved (instant access enabled)', datetime('now'), ?)
        `).run(tagId, userId, message || null, userId);
        
        res.redirect('/tags?message=' + encodeURIComponent(`🎉 Instant access granted to "${tag.name}" tag!`));
      } else {
        // Manual approval required
        // Check if there's already a pending request
        const existingRequest = db.prepare(`
          SELECT status FROM tag_access_requests 
          WHERE tag_id = ? AND user_id = ?
        `).get(tagId, userId);
        
        if (existingRequest) {
          if (existingRequest.status === 'pending') {
            return res.redirect('/tags?error=' + encodeURIComponent('You already have a pending request for this tag'));
          }
          // Update existing request
          db.prepare(`
            UPDATE tag_access_requests 
            SET status = 'pending', 
                request_message = ?, 
                requested_at = datetime('now'),
                responded_at = NULL,
                responded_by = NULL,
                response_message = NULL
            WHERE tag_id = ? AND user_id = ?
          `).run(message || null, tagId, userId);
        } else {
          // Create new request
          db.prepare(`
            INSERT INTO tag_access_requests (tag_id, user_id, request_message)
            VALUES (?, ?, ?)
          `).run(tagId, userId, message || null);
        }
        
        res.redirect('/tags?message=' + encodeURIComponent(`Access request sent for "${tag.name}" tag - awaiting approval`));
      }
    } catch (error) {
      console.error('Error requesting tag access:', error);
      res.redirect('/tags?error=' + encodeURIComponent('Failed to send request'));
    }
  });
  
  // Cancel access request
  router.post('/tags/:id/cancel-request', requireAuth, (req, res) => {
    const tagId = req.params.id;
    const userId = req.session.user.id;
    
    db.prepare(`
      UPDATE tag_access_requests 
      SET status = 'cancelled'
      WHERE tag_id = ? AND user_id = ? AND status = 'pending'
    `).run(tagId, userId);
    
    res.redirect('/tags?message=' + encodeURIComponent('Request cancelled'));
  });
  
  // API endpoint to get tags available to the user
  router.get('/api/tags/available', requireAuth, (req, res) => {
    const userId = req.session.user.id;
    
    try {
      // Get all tags the user has permission to use
      const availableTags = db.prepare(`
        SELECT DISTINCT t.id, t.name, t.description, t.short_description
        FROM tags t
        INNER JOIN tag_permissions tp ON t.id = tp.tag_id
        WHERE tp.user_id = ? AND tp.permission_type IN ('use', 'edit', 'grant')
        AND t.is_active = 1
        ORDER BY t.name
      `).all(userId);
      
      res.json(availableTags);
    } catch (error) {
      console.error('Error fetching available tags:', error);
      res.status(500).json({ error: 'Failed to fetch tags' });
    }
  });
  
  // Serve tag images from database
  router.get('/api/tags/:slug/image', (req, res) => {
    const { slug } = req.params;
    
    try {
      // Get image data from database
      const tag = db.prepare(`
        SELECT image_data 
        FROM tags 
        WHERE slug = ? AND image_data IS NOT NULL
      `).get(slug);
      
      if (!tag || !tag.image_data) {
        return res.status(404).send('Image not found');
      }
      
      // Detect image type from blob data
      const buffer = Buffer.from(tag.image_data);
      let contentType = 'image/jpeg'; // Default
      
      // Check magic bytes to determine image type
      if (buffer[0] === 0x89 && buffer[1] === 0x50) {
        contentType = 'image/png';
      } else if (buffer[0] === 0x47 && buffer[1] === 0x49) {
        contentType = 'image/gif';
      } else if (buffer[0] === 0x52 && buffer[1] === 0x49) {
        contentType = 'image/webp';
      }
      
      // Set caching headers for better performance
      res.set({
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
        'Content-Length': buffer.length
      });
      
      res.send(buffer);
    } catch (error) {
      console.error('Error serving tag image:', error);
      res.status(500).send('Error serving image');
    }
  });
  
  // API endpoint for mosaic infinite scroll
  router.get('/mosaics/:slug/api/letters', (req, res) => {
    const { slug } = req.params;
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = 10;
    const offset = (page - 1) * pageSize;
    const now = dayjs().toISOString();
    const userId = req.session.user?.id || null;
    
    // Get the mosaic (tag) data
    const mosaic = db.prepare('SELECT * FROM tags WHERE slug = ? AND is_active = 1').get(slug);
    
    if (!mosaic) {
      return res.status(404).json({ error: 'Mosaic not found' });
    }
    
    // Check if user has access to this mosaic
    if (!canUserUseTag(userId, mosaic.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Check if is_draft and approval_status columns exist
    let hasDraftColumn = false;
    let hasApprovalColumn = false;
    try {
      const columns = db.prepare("PRAGMA table_info(letters)").all();
      hasDraftColumn = columns.some(col => col.name === 'is_draft');
      hasApprovalColumn = columns.some(col => col.name === 'approval_status');
    } catch (e) {
      console.error('Error checking for columns:', e);
    }
    
    // Get letters from this specific mosaic
    const query = hasApprovalColumn ? `
      SELECT l.*, u.handle, u.bio, u.avatar_url, u.is_slocialite,
        (SELECT COUNT(1) FROM resonates r WHERE r.letter_id = l.id) AS resonate_count,
        EXISTS(SELECT 1 FROM resonates r WHERE r.letter_id = l.id AND r.user_id = @uid) AS did_resonate,
        rs.status AS reading_status
      FROM letters l
      JOIN users u ON u.id = l.author_id
      JOIN letter_tags lt ON lt.letter_id = l.id
      LEFT JOIN reading_status rs ON rs.letter_id = l.id AND rs.user_id = @uid
      WHERE l.is_published = 1 ${hasDraftColumn ? 'AND l.is_draft = 0' : ''} 
        AND l.publish_at <= @now
        AND (l.approval_status = 'approved' OR l.approval_status IS NULL)
        AND lt.tag_id = @tagId
      ORDER BY l.publish_at DESC
      LIMIT @limit OFFSET @offset
    ` : hasDraftColumn ? `
      SELECT l.*, u.handle, u.bio, u.avatar_url, u.is_slocialite,
        (SELECT COUNT(1) FROM resonates r WHERE r.letter_id = l.id) AS resonate_count,
        EXISTS(SELECT 1 FROM resonates r WHERE r.letter_id = l.id AND r.user_id = @uid) AS did_resonate,
        rs.status AS reading_status
      FROM letters l
      JOIN users u ON u.id = l.author_id
      JOIN letter_tags lt ON lt.letter_id = l.id
      LEFT JOIN reading_status rs ON rs.letter_id = l.id AND rs.user_id = @uid
      WHERE l.is_published = 1 AND l.is_draft = 0 AND l.publish_at <= @now
        AND lt.tag_id = @tagId
      ORDER BY l.publish_at DESC
      LIMIT @limit OFFSET @offset
    ` : `
      SELECT l.*, u.handle, u.bio, u.avatar_url, u.is_slocialite,
        (SELECT COUNT(1) FROM resonates r WHERE r.letter_id = l.id) AS resonate_count,
        EXISTS(SELECT 1 FROM resonates r WHERE r.letter_id = l.id AND r.user_id = @uid) AS did_resonate,
        rs.status AS reading_status
      FROM letters l
      JOIN users u ON u.id = l.author_id
      JOIN letter_tags lt ON lt.letter_id = l.id
      LEFT JOIN reading_status rs ON rs.letter_id = l.id AND rs.user_id = @uid
      WHERE l.is_published = 1 AND l.publish_at <= @now
        AND lt.tag_id = @tagId
      ORDER BY l.publish_at DESC
      LIMIT @limit OFFSET @offset
    `;
    
    const params = { now, limit: pageSize + 1, offset, uid: userId || -1, tagId: mosaic.id };
    const letters = db.prepare(query).all(params);
    
    // Check if there are more letters
    const hasMore = letters.length > pageSize;
    if (hasMore) {
      letters.pop(); // Remove the extra letter used for checking
    }
    
    // Add tags to each letter for display
    letters.forEach(letter => {
      letter.tags = getLetterTags(letter.id);
    });
    
    res.json({ 
      letters, 
      hasMore,
      page,
      csrfToken: req.csrfToken()
    });
  });
  
  // Mosaic reading page - individual mosaic reading experience
  router.get('/mosaics/:slug/read', (req, res) => {
    const { slug } = req.params;
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = 10;
    const offset = (page - 1) * pageSize;
    const now = dayjs().toISOString();
    const userId = req.session.user?.id || null;
    
    // Get the mosaic (tag) data
    const mosaic = db.prepare('SELECT * FROM tags WHERE slug = ? AND is_active = 1').get(slug);
    
    if (!mosaic) {
      return res.status(404).send('Mosaic not found');
    }
    
    // Check if user has access to this mosaic
    if (!canUserUseTag(userId, mosaic.id)) {
      if (!userId) {
        return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
      }
      return res.status(403).render('error', {
        user: req.session.user,
        message: 'You need access to this mosaic to read its letters.',
        actionLink: '/tags',
        actionText: 'Request Access'
      });
    }
    
    // Check if is_draft and approval_status columns exist
    let hasDraftColumn = false;
    let hasApprovalColumn = false;
    try {
      const columns = db.prepare("PRAGMA table_info(letters)").all();
      hasDraftColumn = columns.some(col => col.name === 'is_draft');
      hasApprovalColumn = columns.some(col => col.name === 'approval_status');
    } catch (e) {
      console.error('Error checking for columns:', e);
    }
    
    // Get letters from this specific mosaic
    const query = hasApprovalColumn ? `
      SELECT l.*, u.handle, u.bio, u.avatar_url, u.is_slocialite,
        (SELECT COUNT(1) FROM resonates r WHERE r.letter_id = l.id) AS resonate_count,
        EXISTS(SELECT 1 FROM resonates r WHERE r.letter_id = l.id AND r.user_id = @uid) AS did_resonate,
        rs.status AS reading_status
      FROM letters l
      JOIN users u ON u.id = l.author_id
      JOIN letter_tags lt ON lt.letter_id = l.id
      LEFT JOIN reading_status rs ON rs.letter_id = l.id AND rs.user_id = @uid
      WHERE l.is_published = 1 ${hasDraftColumn ? 'AND l.is_draft = 0' : ''} 
        AND l.publish_at <= @now
        AND (l.approval_status = 'approved' OR l.approval_status IS NULL)
        AND lt.tag_id = @tagId
      ORDER BY l.publish_at DESC
      LIMIT @limit OFFSET @offset
    ` : hasDraftColumn ? `
      SELECT l.*, u.handle, u.bio, u.avatar_url, u.is_slocialite,
        (SELECT COUNT(1) FROM resonates r WHERE r.letter_id = l.id) AS resonate_count,
        EXISTS(SELECT 1 FROM resonates r WHERE r.letter_id = l.id AND r.user_id = @uid) AS did_resonate,
        rs.status AS reading_status
      FROM letters l
      JOIN users u ON u.id = l.author_id
      JOIN letter_tags lt ON lt.letter_id = l.id
      LEFT JOIN reading_status rs ON rs.letter_id = l.id AND rs.user_id = @uid
      WHERE l.is_published = 1 AND l.is_draft = 0 AND l.publish_at <= @now
        AND lt.tag_id = @tagId
      ORDER BY l.publish_at DESC
      LIMIT @limit OFFSET @offset
    ` : `
      SELECT l.*, u.handle, u.bio, u.avatar_url, u.is_slocialite,
        (SELECT COUNT(1) FROM resonates r WHERE r.letter_id = l.id) AS resonate_count,
        EXISTS(SELECT 1 FROM resonates r WHERE r.letter_id = l.id AND r.user_id = @uid) AS did_resonate,
        rs.status AS reading_status
      FROM letters l
      JOIN users u ON u.id = l.author_id
      JOIN letter_tags lt ON lt.letter_id = l.id
      LEFT JOIN reading_status rs ON rs.letter_id = l.id AND rs.user_id = @uid
      WHERE l.is_published = 1 AND l.publish_at <= @now
        AND lt.tag_id = @tagId
      ORDER BY l.publish_at DESC
      LIMIT @limit OFFSET @offset
    `;
    
    const params = { now, limit: pageSize, offset, uid: userId || -1, tagId: mosaic.id };
    const letters = db.prepare(query).all(params);
    
    // Add tags to each letter for display
    letters.forEach(letter => {
      letter.tags = getLetterTags(letter.id);
    });
    
    // Get total count for this mosaic
    const countQuery = `
      SELECT COUNT(DISTINCT l.id) as total 
      FROM letters l
      JOIN letter_tags lt ON lt.letter_id = l.id
      WHERE l.is_published = 1 
        ${hasDraftColumn ? 'AND l.is_draft = 0' : ''}
        AND l.publish_at <= ?
        AND lt.tag_id = ?
    `;
    const totalCount = db.prepare(countQuery).get(now, mosaic.id).total;
    
    // Get count of unread letters in this mosaic
    const unreadQuery = userId ? `
      SELECT COUNT(DISTINCT l.id) as unread
      FROM letters l
      JOIN letter_tags lt ON lt.letter_id = l.id
      LEFT JOIN reading_status rs ON rs.letter_id = l.id AND rs.user_id = ?
      WHERE l.is_published = 1 
        ${hasDraftColumn ? 'AND l.is_draft = 0' : ''}
        AND l.publish_at <= ?
        AND lt.tag_id = ?
        AND (rs.status IS NULL OR rs.status = 'later')
    ` : null;
    
    const unreadCount = unreadQuery ? db.prepare(unreadQuery).get(userId, now, mosaic.id).unread : 0;
    
    res.render('mosaic-read', { 
      user: req.session.user, 
      letters, 
      page,
      mosaic,
      totalCount,
      unreadCount,
      pageClass: 'mosaic-read',
      pageTitle: `${mosaic.name} - Mosaic Reading`
    });
  });
  
  // Mosaic management page (for owners)
  router.get('/tags/:id/manage', requireAuth, (req, res) => {
    const tagId = req.params.id;
    const userId = req.session.user.id;
    
    // Check if user is owner
    if (!isTagOwner(userId, tagId)) {
      return res.status(403).send('You are not an owner of this mosaic');
    }
    
    // Get tag details
    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(tagId);
    
    // Get pending requests
    const pendingRequests = db.prepare(`
      SELECT 
        tar.*,
        u.handle,
        u.email,
        u.bio
      FROM tag_access_requests tar
      JOIN users u ON tar.user_id = u.id
      WHERE tar.tag_id = ? AND tar.status = 'pending'
      ORDER BY tar.requested_at DESC
    `).all(tagId);
    
    // Get current permissions
    const permissions = db.prepare(`
      SELECT 
        tp.*,
        u.handle,
        u.email
      FROM tag_permissions tp
      LEFT JOIN users u ON tp.user_id = u.id
      WHERE tp.tag_id = ? AND tp.permission_type = 'use'
      ORDER BY tp.user_id IS NULL DESC, u.handle
    `).all(tagId);
    
    // Get owners
    const owners = getTagOwnership(tagId);
    
    res.render('tag-manage', {
      user: req.session.user,
      tag,
      pendingRequests,
      permissions,
      owners,
      message: req.query.message,
      csrfToken: req.csrfToken(),
      pageTitle: `Manage ${tag.name} - Mosaic`
    });
  });
  
  // Edit mosaic (only for founders)
  router.post('/tags/:id/edit', requireAuth, tagImageUpload.single('image_file'), (req, res) => {
    const tagId = req.params.id;
    const userId = req.session.user.id;
    const { name, short_description, long_description, image_url, is_public, auto_approve, remove_image } = req.body;
    
    // Check if user is the founder
    if (!isTagFounder(userId, tagId)) {
      return res.status(403).send('Only the mosaic founder can edit mosaic details');
    }
    
    // Validate required fields
    if (!name || !short_description) {
      return res.redirect(`/tags/${tagId}/manage?error=` + encodeURIComponent('Mosaic name and short description are required'));
    }
    
    // Create slug from name
    const slug = name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    
    try {
      // Check if another tag with same name exists (case-insensitive)
      const existing = db.prepare(`
        SELECT id FROM tags WHERE name COLLATE NOCASE = ? AND id != ?
      `).get(name, tagId);
      
      if (existing) {
        return res.redirect(`/tags/${tagId}/manage?error=` + encodeURIComponent('A tag with this name already exists'));
      }
      
      // Get current tag to check for existing image
      const currentTag = db.prepare('SELECT image_url, slug FROM tags WHERE id = ?').get(tagId);
      let finalImageUrl = currentTag.image_url;
      let imageData = null;
      
      // Handle image updates
      if (remove_image === 'true') {
        // User wants to remove the image
        finalImageUrl = null;
        imageData = null; // This will clear the blob
      } else if (req.file) {
        // New file uploaded - store as blob
        imageData = req.file.buffer;
        finalImageUrl = `/api/tags/${slug}/image`;
      } else if (image_url && image_url !== currentTag.image_url) {
        // New URL provided
        finalImageUrl = image_url;
        imageData = null; // Clear any existing blob when using URL
      }
      
      // Update the tag
      if (imageData !== null || remove_image === 'true' || req.file) {
        // Update including image_data when we have changes to the image
        db.prepare(`
          UPDATE tags SET 
            name = ?,
            slug = ?,
            description = ?,
            short_description = ?,
            long_description = ?,
            image_url = ?,
            image_data = ?,
            is_public = ?,
            auto_approve = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(
          name,
          slug,
          short_description, // Use short_description for the main description field
          short_description,
          long_description || null,
          finalImageUrl,
          imageData,
          is_public ? 1 : 0,
          auto_approve ? 1 : 0,
          tagId
        );
      } else {
        // Update without touching image_data if no image changes
        db.prepare(`
          UPDATE tags SET 
            name = ?,
            slug = ?,
            description = ?,
            short_description = ?,
            long_description = ?,
            image_url = ?,
            is_public = ?,
            auto_approve = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(
          name,
          slug,
          short_description, // Use short_description for the main description field
          short_description,
          long_description || null,
          finalImageUrl,
          is_public ? 1 : 0,
          auto_approve ? 1 : 0,
          tagId
        );
      }
      
      res.redirect(`/tags/${tagId}/manage?message=` + encodeURIComponent('Tag updated successfully!'));
      
    } catch (error) {
      console.error('Error updating tag:', error);
      res.redirect(`/tags/${tagId}/manage?error=` + encodeURIComponent('Failed to update tag'));
    }
  });
  
  // Approve/Reject access request
  router.post('/tags/:id/manage/request/:requestId', requireAuth, (req, res) => {
    const tagId = req.params.id;
    const requestId = req.params.requestId;
    const userId = req.session.user.id;
    const { action, response_message } = req.body;
    
    // Check if user is owner
    if (!isTagOwner(userId, tagId)) {
      return res.status(403).send('You are not an owner of this tag');
    }
    
    // Get request details
    const request = db.prepare(`
      SELECT * FROM tag_access_requests 
      WHERE id = ? AND tag_id = ? AND status = 'pending'
    `).get(requestId, tagId);
    
    if (!request) {
      return res.redirect(`/tags/${tagId}/manage?message=` + encodeURIComponent('Request not found'));
    }
    
    const now = dayjs().toISOString();
    
    if (action === 'approve') {
      // Approve request
      db.prepare(`
        UPDATE tag_access_requests 
        SET status = 'approved', 
            responded_at = ?, 
            responded_by = ?,
            response_message = ?
        WHERE id = ?
      `).run(now, userId, response_message || null, requestId);
      
      // Grant permission
      db.prepare(`
        INSERT OR IGNORE INTO tag_permissions (tag_id, user_id, permission_type, granted_by)
        VALUES (?, ?, 'use', ?)
      `).run(tagId, request.user_id, userId);
      
      res.redirect(`/tags/${tagId}/manage?message=` + encodeURIComponent('Access granted'));
    } else if (action === 'reject') {
      // Reject request
      db.prepare(`
        UPDATE tag_access_requests 
        SET status = 'rejected', 
            responded_at = ?, 
            responded_by = ?,
            response_message = ?
        WHERE id = ?
      `).run(now, userId, response_message || null, requestId);
      
      res.redirect(`/tags/${tagId}/manage?message=` + encodeURIComponent('Request rejected'));
    } else {
      res.redirect(`/tags/${tagId}/manage`);
    }
  });
  
  // Delete draft
  router.post('/drafts/:id/delete', requireAuth, (req, res) => {
    const draftId = req.params.id;
    
    // Verify ownership and delete (temporarily delete unpublished letters)
    const result = db.prepare(`
      DELETE FROM letters 
      WHERE id = ? 
        AND author_id = ? 
        AND is_published = 0
        AND publish_at > datetime('now', '+12 hours')
    `).run(draftId, req.session.user.id);
    
    if (result.changes === 0) {
      return res.status(404).send('Draft not found');
    }
    
    eventTracker.track('draft_delete', {
      userId: req.session.user.id,
      sessionId: req.sessionID,
      letterId: draftId
    });
    
    res.redirect('/drafts');
  });
  
  router.get('/compose/draft/:id', requireAuth, (req, res) => {
    // Temporarily check for unpublished letters as drafts
    const draft = db.prepare(`
      SELECT * FROM letters 
      WHERE id = ? 
        AND author_id = ? 
        AND is_published = 0
        AND publish_at > datetime('now', '+12 hours')
    `).get(req.params.id, req.session.user.id);
    
    if (!draft) {
      return res.status(404).send('Draft not found');
    }
    
    res.render('compose', { 
      user: req.session.user, 
      errors: [], 
      values: draft,
      draft,
      pageClass: 'compose',
      theme: req.cookies?.theme || 'light'
    });
  });
  
  router.post('/compose/draft/:id', requireAuth,
    body('title').isLength({ min: 1, max: 120 }),
    body('body').isLength({ min: 1, max: 50000 }),
    (req, res) => {
      const { title, body, action } = req.body;
      const draftId = req.params.id;
      const now = dayjs();
      
      // Verify ownership (temporarily check unpublished letters)
      const draft = db.prepare(`
        SELECT * FROM letters 
        WHERE id = ? 
          AND author_id = ? 
          AND is_published = 0
      `).get(draftId, req.session.user.id);
      
      if (!draft) {
        return res.status(404).send('Draft not found');
      }
      
      if (action === 'draft') {
        // Update draft
        db.prepare(`
          UPDATE letters 
          SET title = ?, body = ?
          WHERE id = ?
        `).run(title, body, draftId);
        
        return res.redirect(`/compose/draft/${draftId}?saved=true`);
      } else {
        // Convert to published letter
        const publish_at = now.add(12, 'hour').toISOString();
        db.prepare(`
          UPDATE letters 
          SET title = ?, body = ?, publish_at = ?
          WHERE id = ?
        `).run(title, body, publish_at, draftId);
        
        eventTracker.track('draft_publish', {
          userId: req.session.user.id,
          sessionId: req.sessionID,
          letterId: draftId,
          metadata: { title: title.slice(0, 50) }
        });
        
        return res.redirect(`/letters/${draftId}`);
      }
    }
  );
  router.post('/compose', requireAuth,
    body('title').isLength({ min: 1, max: 120 }),
    body('body').isLength({ min: 1, max: 500000 }), // Increased to allow multiple images
    (req, res) => {
      console.log('POST /compose - Request received');
      console.log('Body size:', JSON.stringify(req.body).length, 'bytes');
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).render('compose', { user: req.session.user, errors: errors.array(), values: req.body, pageClass: 'compose' });

      const { title, body, action, format = 'standard', tags } = req.body;
      const now = dayjs();
      
      if (action === 'draft') {
        // Save as draft (temporarily as unpublished letter until migration completes)
        try {
          const info = db.prepare(`
            INSERT INTO letters (author_id, title, body, format, publish_at, created_at, is_published) 
            VALUES (?, ?, ?, ?, ?, ?, 0)
          `).run(
            req.session.user.id, 
            title, 
            body,
            format,
            now.add(24, 'hour').toISOString(), // Set far future for draft
            now.toISOString()
          );
        
          eventTracker.track('draft_save', {
            userId: req.session.user.id,
            sessionId: req.sessionID,
            letterId: info.lastInsertRowid,
            metadata: { title: title.slice(0, 50) }
          });
          
          return res.redirect(`/drafts?saved=${info.lastInsertRowid}`);
        } catch (error) {
          console.error('Error saving draft:', error);
          return res.status(500).render('compose', { 
            user: req.session.user, 
            errors: [{ msg: 'Failed to save draft. Please try again.' }], 
            values: req.body, 
            pageClass: 'compose' 
          });
        }
      } else {
        // Publish (queue for publishing)
        // Check if they published recently (honor system reminder)
        const last = db.prepare('SELECT created_at FROM letters WHERE author_id = ? ORDER BY created_at DESC LIMIT 1')
          .get(req.session.user.id);
        
        // If they published recently and haven't confirmed, show reminder
        if (last && dayjs(last.created_at).isAfter(dayjs().subtract(24, 'hour')) && action !== 'publish-confirmed') {
          const hoursAgo = Math.round(dayjs().diff(dayjs(last.created_at), 'hour', true));
          const timeLeft = 24 - hoursAgo;
          
          return res.render('compose', { 
            user: req.session.user, 
            errors: [], 
            values: req.body, 
            pageClass: 'compose',
            showReminderModal: true,
            lastPublished: {
              hoursAgo: hoursAgo,
              timeLeft: timeLeft
            }
          });
        }

        try {
          const publish_at = dayjs().add(12, 'hour').toISOString();
          const now = dayjs().toISOString();
          
          // Check if user is a slocialite (needs approval)
          const user = db.prepare('SELECT is_slocialite FROM users WHERE id = ?').get(req.session.user.id);
          const needsApproval = user?.is_slocialite === 1;
          
          // Check if approval_status column exists
          let hasApprovalColumn = false;
          try {
            const columns = db.prepare("PRAGMA table_info(letters)").all();
            hasApprovalColumn = columns.some(col => col.name === 'approval_status');
          } catch (e) {
            // Column might not exist yet
          }
          
          let info;
          if (hasApprovalColumn && needsApproval) {
            // Insert with pending status for slocialites
            info = db.prepare('INSERT INTO letters (author_id, title, body, format, publish_at, created_at, is_published, approval_status) VALUES (?, ?, ?, ?, ?, ?, 0, ?)')
              .run(req.session.user.id, title, body, format, publish_at, now, 'pending');
          } else {
            // Regular user or old schema - insert normally
            info = db.prepare('INSERT INTO letters (author_id, title, body, format, publish_at, created_at, is_published) VALUES (?, ?, ?, ?, ?, ?, 0)')
              .run(req.session.user.id, title, body, format, publish_at, now);
          }
          
          const letterId = info.lastInsertRowid;
          
          // Process tags if provided
          if (tags) {
            try {
              const parsedTags = JSON.parse(tags);
              
              for (const tag of parsedTags) {
                let tagId = tag.id;
                
                // If it's a new tag, create it first
                if (tag.isNew || !tagId) {
                  // Create slug from name
                  const slug = tag.name.toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '');
                  
                  // Check if tag with this name already exists
                  const existingTag = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE').get(tag.name);
                  
                  if (existingTag) {
                    tagId = existingTag.id;
                  } else {
                    // Create new tag
                    const tagResult = db.prepare(`
                      INSERT INTO tags (name, slug, created_by, is_public, is_active)
                      VALUES (?, ?, ?, 1, 1)
                    `).run(tag.name, slug, req.session.user.id);
                    
                    tagId = tagResult.lastInsertRowid;
                    
                    // Grant the creator permission to use the tag
                    db.prepare(`
                      INSERT INTO tag_permissions (tag_id, user_id, permission_type, granted_by)
                      VALUES (?, ?, 'use', ?)
                    `).run(tagId, req.session.user.id, req.session.user.id);
                    
                    // Add as owner
                    db.prepare(`
                      INSERT INTO tag_owners (tag_id, user_id, ownership_type)
                      VALUES (?, ?, 'founder')
                    `).run(tagId, req.session.user.id);
                  }
                }
                
                // Check if user has permission to use this tag
                if (canUserUseTag(req.session.user.id, tagId)) {
                  // Add tag to letter
                  try {
                    db.prepare(`
                      INSERT INTO letter_tags (letter_id, tag_id, added_by)
                      VALUES (?, ?, ?)
                    `).run(letterId, tagId, req.session.user.id);
                  } catch (e) {
                    // Ignore duplicate tag assignments
                    if (!e.message.includes('UNIQUE constraint failed')) {
                      console.error('Error adding tag to letter:', e);
                    }
                  }
                }
              }
            } catch (error) {
              console.error('Error processing tags:', error);
              // Continue anyway - letter is already saved
            }
          }
          
          eventTracker.track('letter_create', {
            userId: req.session.user.id,
            sessionId: req.sessionID,
            letterId: letterId,
            metadata: { title: title.slice(0, 50), wordCount: body.split(/\s+/).length, needsApproval }
          });
          
          if (needsApproval && hasApprovalColumn) {
            return res.render('compose', { 
              user: req.session.user, 
              errors: [], 
              values: {}, 
              pageClass: 'compose',
              message: 'Your letter has been submitted for review. It will be published after approval.'
            });
          }
          
          res.redirect(`/letters/${letterId}`);
        } catch (error) {
          console.error('Error publishing letter:', error);
          return res.status(500).render('compose', { 
            user: req.session.user, 
            errors: [{ msg: 'Failed to publish letter. Please try again.' }], 
            values: req.body, 
            pageClass: 'compose' 
          });
        }
      }
    }
  );

  router.get('/letters/:id', (req, res) => {
    const id = Number(req.params.id);
    const userId = req.session.user?.id || null;
    const uid = userId || -1; // Keep for backward compatibility
    const referrer = req.query.ref || req.headers.referer || 'direct';
    
    // First check if user has permission to view this letter based on tags
    if (!canUserViewLetter(userId, id)) {
      return res.status(403).send('You do not have permission to view this letter');
    }
    
    // Log the view action if user is logged in
    if (userId) {
      let referrerType = 'direct';
      let referrerId = null;
      
      if (referrer.includes('/mosaics/')) {
        referrerType = 'mosaic';
        const match = referrer.match(/\/mosaics\/([^\/]+)/);
        if (match) referrerId = match[1];
      } else if (referrer === '/' || referrer.includes('/?')) {
        referrerType = 'home';
      } else if (referrer.includes('/profile')) {
        referrerType = 'profile';
      }
      
      logReadingActivity(userId, id, 'view', {
        referrerType,
        referrerId,
        deviceType: req.headers['user-agent']?.includes('Mobile') ? 'mobile' : 'desktop'
      });
    }
    
    // Check if is_draft column exists
    let hasDraftColumn = false;
    try {
      const columns = db.prepare("PRAGMA table_info(letters)").all();
      hasDraftColumn = columns.some(col => col.name === 'is_draft');
    } catch (e) {
      console.error('Error checking for is_draft column:', e);
    }
    
    const query = hasDraftColumn ? `
      SELECT l.*, u.handle, u.bio, u.avatar_url, u.is_slocialite,
        (SELECT COUNT(1) FROM resonates r WHERE r.letter_id = l.id) AS resonate_count,
        EXISTS(SELECT 1 FROM resonates r WHERE r.letter_id = l.id AND r.user_id = @uid) AS did_resonate
      FROM letters l JOIN users u ON u.id = l.author_id 
      WHERE l.id = @id AND (l.is_draft = 0 OR (l.is_draft = 1 AND l.author_id = @uid))
    ` : `
      SELECT l.*, u.handle, u.bio, u.avatar_url, u.is_slocialite,
        (SELECT COUNT(1) FROM resonates r WHERE r.letter_id = l.id) AS resonate_count,
        EXISTS(SELECT 1 FROM resonates r WHERE r.letter_id = l.id AND r.user_id = @uid) AS did_resonate
      FROM letters l JOIN users u ON u.id = l.author_id 
      WHERE l.id = @id
    `;
    
    const letter = db.prepare(query).get({ id, uid });
    if (!letter) return res.status(404).send('Not found');
    
    // Get tags for this letter
    letter.tags = getLetterTags(id);
    
    // Mark as reading/read if user is logged in
    if (req.session.user) {
      try {
        const now = dayjs().toISOString();
        
        // Check current status
        const currentStatus = db.prepare('SELECT status FROM reading_status WHERE user_id = ? AND letter_id = ?')
          .get(uid, id);
        
        // Set status to 'reading' when they start reading (unless already read)
        if (!currentStatus || (currentStatus.status !== 'read' && currentStatus.status !== 'reading')) {
          db.prepare(`
            INSERT INTO reading_status (user_id, letter_id, status, started_at, created_at, updated_at)
            VALUES (?, ?, 'reading', ?, ?, ?)
            ON CONFLICT(user_id, letter_id) 
            DO UPDATE SET 
              status = CASE 
                WHEN status IN ('skip', 'later') THEN 'reading'
                ELSE status 
              END,
              started_at = COALESCE(started_at, ?),
              updated_at = ?
          `).run(uid, id, now, now, now, now, now);
          
          // Track the reading start event
          eventTracker.track('letter_read_start', {
            userId: uid,
            sessionId: req.sessionID,
            letterId: id,
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
            metadata: { 
              letterTitle: letter.title,
              previousStatus: currentStatus?.status || 'none'
            }
          });
        }
      } catch (error) {
        console.error('Error updating reading status:', error);
      }
    }

    const comments = db.prepare(`
      SELECT c.*, u.handle FROM comments c JOIN users u ON u.id = c.author_id WHERE c.letter_id = ? ORDER BY c.created_at ASC
    `).all(id);

    const can_view = letter.is_published === 1 && dayjs(letter.publish_at).isBefore(dayjs());
    const is_author = uid === letter.author_id;
    if (!can_view && !is_author) return res.status(403).send('Not yet published');

    // Render markdown for letter body
    letter.body_html = renderMarkdown(letter.body);
    
    // Render markdown for comments
    comments.forEach(comment => {
      comment.body_html = renderMarkdown(comment.body);
    });

    res.render('letter', { user: req.session.user, letter, comments });
  });

  router.post('/letters/:id/resonate', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    try {
      db.prepare('INSERT OR IGNORE INTO resonates (letter_id, user_id) VALUES (?, ?)').run(id, req.session.user.id);
      eventTracker.track('resonate', {
        userId: req.session.user.id,
        sessionId: req.sessionID,
        letterId: id,
        metadata: { action: 'add' }
      });
    } catch {}
    res.redirect(`/letters/${id}`);
  });
  router.post('/letters/:id/status', requireAuth, (req, res) => {
    const { id } = req.params;
    const { status, readingTime, referrer, referrerType } = req.body;
    const userId = req.session.user.id;
    
    try {
      if (status === 'remove') {
        // Remove the reading status
        db.prepare('DELETE FROM reading_status WHERE user_id = ? AND letter_id = ?')
          .run(userId, id);
        
        // Log the action
        logReadingActivity(userId, id, 'remove_later', {
          referrerType: referrerType || 'unknown',
          referrerId: referrer || null
        });
      } else if (['read', 'skip', 'later', 'reading'].includes(status)) {
        // Update or insert reading status
        const now = dayjs().toISOString();
        db.prepare(`
          INSERT INTO reading_status (user_id, letter_id, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id, letter_id) 
          DO UPDATE SET status = ?, updated_at = ?
        `).run(userId, id, status, now, now, status, now);
        
        // Log the reading activity
        logReadingActivity(userId, id, status, {
          readingTime: readingTime || null,
          referrerType: referrerType || 'unknown',
          referrerId: referrer || null,
          deviceType: req.headers['user-agent']?.includes('Mobile') ? 'mobile' : 'desktop'
        });
        
        // Track event
        eventTracker.track('reading_status', {
          userId,
          sessionId: req.sessionID,
          letterId: id,
          metadata: { status }
        });
      } else {
        return res.status(400).json({ success: false, error: 'Invalid status' });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating reading status:', error);
      res.status(500).json({ success: false, error: 'Failed to update status' });
    }
  });
  
  router.post('/letters/:id/unresonate', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM resonates WHERE letter_id = ? AND user_id = ?').run(id, req.session.user.id);
    res.redirect(`/letters/${id}`);
  });

  router.post('/letters/:id/comment', requireAuth,
    body('body').isLength({ min: 1, max: 2000 }),
    (req, res) => {
      const id = Number(req.params.id);
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).redirect(`/letters/${id}`);
      try {
        const info = db.prepare('INSERT INTO comments (letter_id, author_id, body) VALUES (?, ?, ?)').run(id, req.session.user.id, req.body.body);
        eventTracker.track('comment', {
          userId: req.session.user.id,
          sessionId: req.sessionID,
          letterId: id,
          metadata: { commentId: info.lastInsertRowid, length: req.body.body.length }
        });
      } catch (e) {
        // Ignore duplicate comment per user
      }
      res.redirect(`/letters/${id}`);
    }
  );

  // Cron-like endpoint to publish letters past publish_at; could be hit by uptime pinger
  router.post('/internal/publish', (req, res) => {
    const now = dayjs().toISOString();
    const info = db.prepare('UPDATE letters SET is_published = 1 WHERE is_published = 0 AND publish_at <= ?').run(now);
    res.json({ published: info.changes });
  });

  // Admin routes (hidden)
  // Admin Event Log
  router.get('/admin/events', requireAdmin, (req, res) => {
    const eventType = req.query.type || '';
    const period = req.query.period || '24h';
    const view = req.query.view || 'sessions'; // Default to session view
    
    const filters = {};
    if (eventType) filters.eventType = eventType;
    
    let events = [];
    let sessions = [];
    
    if (view === 'sessions') {
      sessions = eventTracker.getSessionGroupedEvents(50, filters);
    } else {
      events = eventTracker.getRecentEvents(200, filters);
    }
    
    const analytics = eventTracker.getAnalytics(period);
    
    res.render('admin-events', { 
      user: req.session.user, 
      events, 
      sessions,
      analytics, 
      selectedType: eventType,
      selectedPeriod: period,
      selectedView: view
    });
  });

  router.get('/admin', requireAdmin, (req, res) => {
    const filter = req.query.filter || 'all';
    
    // Check if approval_status column exists
    let hasApprovalColumn = false;
    try {
      const columns = db.prepare("PRAGMA table_info(letters)").all();
      hasApprovalColumn = columns.some(col => col.name === 'approval_status');
    } catch (e) {
      // Column might not exist yet
    }
    
    // Get letters based on filter
    let lettersQuery = `
      SELECT l.*, u.handle, u.is_slocialite,
        (SELECT COUNT(*) FROM comments WHERE letter_id = l.id) as comment_count,
        (SELECT COUNT(*) FROM resonates WHERE letter_id = l.id) as resonate_count
      FROM letters l 
      JOIN users u ON u.id = l.author_id 
    `;
    
    if (filter === 'moderation' && hasApprovalColumn) {
      lettersQuery += ` WHERE l.approval_status = 'pending' `;
    } else if (filter === 'pending') {
      lettersQuery += ' WHERE l.is_published = 0 ';
    } else if (filter === 'published') {
      lettersQuery += ' WHERE l.is_published = 1 ';
    }
    
    lettersQuery += ' ORDER BY l.created_at DESC LIMIT 50';
    const letters = db.prepare(lettersQuery).all();
    
    const comments = db.prepare(`
      SELECT c.*, u.handle, l.title FROM comments c 
      JOIN users u ON u.id = c.author_id 
      JOIN letters l ON l.id = c.letter_id
      ORDER BY c.created_at DESC LIMIT 50
    `).all();
    
    const users = db.prepare('SELECT id, handle, email, is_admin, created_at FROM users ORDER BY created_at DESC LIMIT 50').all();
    
    // Get stats
    const stats = {
      totalUsers: db.prepare('SELECT COUNT(*) as count FROM users').get().count,
      totalLetters: db.prepare('SELECT COUNT(*) as count FROM letters').get().count,
      pendingLetters: db.prepare('SELECT COUNT(*) as count FROM letters WHERE is_published = 0').get().count,
      totalComments: db.prepare('SELECT COUNT(*) as count FROM comments').get().count
    };
    
    res.render('admin', { user: req.session.user, letters, comments, users, stats, filter });
  });

  router.post('/admin/delete-letter/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM comments WHERE letter_id = ?').run(id);
    db.prepare('DELETE FROM resonates WHERE letter_id = ?').run(id);
    db.prepare('DELETE FROM letters WHERE id = ?').run(id);
    res.redirect('/admin');
  });

  router.post('/admin/delete-comment/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM comments WHERE id = ?').run(id);
    res.redirect('/admin');
  });

  router.post('/admin/toggle-admin/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (id === req.session.user.id) return res.redirect('/admin'); // Can't remove own admin
    db.prepare('UPDATE users SET is_admin = CASE WHEN is_admin = 1 THEN 0 ELSE 1 END WHERE id = ?').run(id);
    res.redirect('/admin');
  });

  // Force publish a pending letter immediately
  router.post('/admin/publish-now/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    db.prepare("UPDATE letters SET is_published = 1, publish_at = datetime('now') WHERE id = ?").run(id);
    res.redirect('/admin');
  });

  // Unpublish a letter (hide it)
  router.post('/admin/unpublish/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    db.prepare('UPDATE letters SET is_published = 0 WHERE id = ?').run(id);
    res.redirect('/admin');
  });

  // Ban/suspend a user (soft delete - they can't login)
  router.post('/admin/ban-user/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (id === req.session.user.id) return res.redirect('/admin'); // Can't ban yourself
    // Add random string to email to effectively ban them
    db.prepare('UPDATE users SET email = email || "_banned_" || ? WHERE id = ?').run(Date.now(), id);
    res.redirect('/admin');
  });

  // Promote Slocialite to Author
  router.post('/admin/promote-to-author/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    
    // Check if is_slocialite column exists
    let hasSlocialiteColumn = false;
    try {
      const columns = db.prepare("PRAGMA table_info(users)").all();
      hasSlocialiteColumn = columns.some(col => col.name === 'is_slocialite');
    } catch (e) {
      // Column might not exist yet
    }
    
    if (hasSlocialiteColumn) {
      db.prepare('UPDATE users SET is_slocialite = 0 WHERE id = ?').run(id);
      
      eventTracker.track('user_promoted', {
        userId: req.session.user.id,
        sessionId: req.sessionID,
        metadata: { promotedUserId: id, newRole: 'author' }
      });
    }
    
    res.redirect('/admin');
  });

  // Approve a letter from slocialite
  router.post('/admin/approve/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const now = dayjs().toISOString();
    
    // Check if approval columns exist
    let hasApprovalColumns = false;
    try {
      const columns = db.prepare("PRAGMA table_info(letters)").all();
      hasApprovalColumns = columns.some(col => col.name === 'approval_status');
    } catch (e) {
      // Columns might not exist yet
    }
    
    if (hasApprovalColumns) {
      db.prepare(`
        UPDATE letters 
        SET approval_status = 'approved', 
            approved_by = ?, 
            approved_at = ?
        WHERE id = ?
      `).run(req.session.user.id, now, id);
      
      eventTracker.track('letter_approved', {
        userId: req.session.user.id,
        sessionId: req.sessionID,
        letterId: id,
        metadata: { action: 'approve' }
      });
    }
    
    res.redirect('/admin?filter=moderation');
  });

  // Reject a letter from slocialite
  router.post('/admin/reject/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const now = dayjs().toISOString();
    const reason = req.body.reason || 'Does not meet community guidelines';
    
    // Check if approval columns exist
    let hasApprovalColumns = false;
    try {
      const columns = db.prepare("PRAGMA table_info(letters)").all();
      hasApprovalColumns = columns.some(col => col.name === 'approval_status');
    } catch (e) {
      // Columns might not exist yet
    }
    
    if (hasApprovalColumns) {
      db.prepare(`
        UPDATE letters 
        SET approval_status = 'rejected', 
            approved_by = ?, 
            approved_at = ?,
            rejection_reason = ?
        WHERE id = ?
      `).run(req.session.user.id, now, reason, id);
      
      eventTracker.track('letter_rejected', {
        userId: req.session.user.id,
        sessionId: req.sessionID,
        letterId: id,
        metadata: { action: 'reject', reason }
      });
    }
    
    res.redirect('/admin?filter=moderation');
  });

  // 404 handler - track not found pages
  router.use((req, res) => {
    eventTracker.track('404_error', {
      sessionId: req.sessionID,
      userId: req.session.user?.id || null,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      path: req.path,
      method: req.method,
      metadata: {
        referrer: req.get('referrer') || 'direct',
        fullUrl: req.originalUrl
      }
    });
    res.status(404).send('Not found');
  });

  return router;
}

module.exports = { buildRouter };


