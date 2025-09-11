const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const dayjs = require('dayjs');
const { marked } = require('marked');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const eventTracker = require('./services/eventTracker');
const passport = require('passport');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

// Configure marked
marked.setOptions({
  breaks: true,
  gfm: true,
  headerIds: false,
  mangle: false
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
    
    // Use appropriate query based on available columns
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
      ORDER BY l.publish_at DESC
      LIMIT @limit OFFSET @offset
    `;
    
    const letters = db.prepare(query).all({ now, limit: pageSize, offset, uid: req.session.user?.id || -1 });

    res.render('index', { user: req.session.user, letters, page, pageClass: 'home' });
  });

  router.get('/about', (req, res) => {
    res.render('about', { user: req.session.user });
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
    
    // Check if is_draft column exists
    let hasDraftColumn = false;
    try {
      const columns = db.prepare("PRAGMA table_info(letters)").all();
      hasDraftColumn = columns.some(col => col.name === 'is_draft');
    } catch (e) {
      console.error('Error checking for is_draft column:', e);
    }
    
    // Use appropriate query based on whether draft column exists
    const query = hasDraftColumn ? `
      SELECT l.*, u.handle, u.bio, u.avatar_url, u.is_slocialite,
        (SELECT COUNT(1) FROM resonates r WHERE r.letter_id = l.id) AS resonate_count,
        EXISTS(SELECT 1 FROM resonates r WHERE r.letter_id = l.id AND r.user_id = @uid) AS did_resonate,
        rs.status AS reading_status
      FROM letters l
      JOIN users u ON u.id = l.author_id
      LEFT JOIN reading_status rs ON rs.letter_id = l.id AND rs.user_id = @uid
      WHERE l.is_published = 1 AND l.is_draft = 0 AND l.publish_at <= @now
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
      ORDER BY l.publish_at DESC
      LIMIT @limit OFFSET @offset
    `;
    
    const letters = db.prepare(query).all({ now, limit: pageSize, offset, uid: req.session.user?.id || -1 });
    
    // Check if there are more letters
    const countQuery = hasDraftColumn ? 
      'SELECT COUNT(*) as total FROM letters WHERE is_published = 1 AND is_draft = 0 AND publish_at <= ?' :
      'SELECT COUNT(*) as total FROM letters WHERE is_published = 1 AND publish_at <= ?';
    const totalCount = db.prepare(countQuery).get(now).total;
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
        const result = db.prepare('INSERT INTO letters (author_id, title, body, is_draft, last_saved_at, created_at, publish_at, is_published) VALUES (?, ?, ?, 1, ?, ?, ?, 0)')
          .run(userId, title, body, now, now, now, 0);
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

  router.get('/signup', (req, res) => res.render('signup', { user: req.session.user, errors: [], values: {}, pageClass: 'auth' }));
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
        
        req.session.user = { id: info.lastInsertRowid, handle, email, is_admin: false, is_slocialite: hasSlocialiteColumn ? true : false };
      eventTracker.track('signup', {
        userId: info.lastInsertRowid,
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

  router.get('/login', (req, res) => res.render('login', { user: req.session.user, errors: [], values: {}, pageClass: 'auth' }));
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
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
    res.render('profile', { user: req.session.user, profile: user, errors: [], isAuthor: user.is_slocialite === 0 });
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

  router.get('/compose', requireAuth, (req, res) => {
    res.render('compose', { user: req.session.user, errors: [], values: {}, pageClass: 'compose' });
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
      saved: !!saved 
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
    
    // Check 24-hour limit
    const lastPublished = db.prepare('SELECT created_at FROM letters WHERE author_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(req.session.user.id);
    
    if (lastPublished && dayjs(lastPublished.created_at).isAfter(now.subtract(24, 'hour'))) {
      return res.status(429).send('You can only publish one letter per 24 hours. Please wait before publishing.');
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
      pageClass: 'compose'
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

      const { title, body, action } = req.body;
      const now = dayjs();
      
      if (action === 'draft') {
        // Save as draft (temporarily as unpublished letter until migration completes)
        try {
          const info = db.prepare(`
            INSERT INTO letters (author_id, title, body, publish_at, created_at, is_published) 
            VALUES (?, ?, ?, ?, ?, 0)
          `).run(
            req.session.user.id, 
            title, 
            body, 
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
        // Enforce 1 letter per 24h (temporarily disabled draft check until migration completes)
        const last = db.prepare('SELECT created_at FROM letters WHERE author_id = ? ORDER BY created_at DESC LIMIT 1')
          .get(req.session.user.id);
        if (last && dayjs(last.created_at).isAfter(dayjs().subtract(24, 'hour'))) {
          return res.status(429).render('compose', { user: req.session.user, errors: [{ msg: 'You can only publish once every 24 hours.' }], values: req.body, pageClass: 'compose' });
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
            info = db.prepare('INSERT INTO letters (author_id, title, body, publish_at, created_at, is_published, approval_status) VALUES (?, ?, ?, ?, ?, 0, ?)')
              .run(req.session.user.id, title, body, publish_at, now, 'pending');
          } else {
            // Regular user or old schema - insert normally
            info = db.prepare('INSERT INTO letters (author_id, title, body, publish_at, created_at, is_published) VALUES (?, ?, ?, ?, ?, 0)')
              .run(req.session.user.id, title, body, publish_at, now);
          }
          
          eventTracker.track('letter_create', {
            userId: req.session.user.id,
            sessionId: req.sessionID,
            letterId: info.lastInsertRowid,
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
          
          res.redirect(`/letters/${info.lastInsertRowid}`);
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
    const uid = req.session.user?.id || -1;
    
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
    const { status } = req.body;
    const userId = req.session.user.id;
    
    try {
      if (status === 'remove') {
        // Remove the reading status
        db.prepare('DELETE FROM reading_status WHERE user_id = ? AND letter_id = ?')
          .run(userId, id);
      } else if (['read', 'skip', 'later', 'reading'].includes(status)) {
        // Update or insert reading status
        const now = dayjs().toISOString();
        db.prepare(`
          INSERT INTO reading_status (user_id, letter_id, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id, letter_id) 
          DO UPDATE SET status = ?, updated_at = ?
        `).run(userId, id, status, now, now, status, now);
        
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


