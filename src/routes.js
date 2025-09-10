const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const dayjs = require('dayjs');
const { marked } = require('marked');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const eventTracker = require('./services/eventTracker');

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
    const letters = db.prepare(`
      SELECT l.*, u.handle,
        (SELECT COUNT(1) FROM resonates r WHERE r.letter_id = l.id) AS resonate_count,
        EXISTS(SELECT 1 FROM resonates r WHERE r.letter_id = l.id AND r.user_id = @uid) AS did_resonate
      FROM letters l
      JOIN users u ON u.id = l.author_id
      WHERE l.is_published = 1 AND l.publish_at <= @now
      ORDER BY l.publish_at DESC
      LIMIT @limit OFFSET @offset
    `).all({ now, limit: pageSize, offset, uid: req.session.user?.id || -1 });

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
  router.get('/principles', (req, res) => {
    res.render('principles', { user: req.session.user });
  });

  router.get('/signup', (req, res) => res.render('signup', { user: req.session.user, errors: [], values: {} }));
  router.post('/signup',
    body('handle').isLength({ min: 3, max: 20 }).isAlphanumeric().withMessage('Handle must be alphanumeric 3-20'),
    body('email').isEmail(),
    body('password').isLength({ min: 8 }),
    (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).render('signup', { user: req.session.user, errors: errors.array(), values: req.body });
      }
      const { handle, email, password } = req.body;
      const password_hash = bcrypt.hashSync(password, 12);
      try {
        const info = db.prepare('INSERT INTO users (handle, email, password_hash) VALUES (?, ?, ?)').run(handle, email, password_hash);
      req.session.user = { id: info.lastInsertRowid, handle, email, is_admin: false };
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
        res.status(400).render('signup', { user: req.session.user, errors: [{ msg }], values: req.body });
      }
    }
  );

  router.get('/login', (req, res) => res.render('login', { user: req.session.user, errors: [], values: {} }));
  router.post('/login',
    body('email').isEmail(),
    body('password').isLength({ min: 8 }),
    (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).render('login', { user: req.session.user, errors: errors.array(), values: req.body });
      const { email, password } = req.body;
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        return res.status(401).render('login', { user: req.session.user, errors: [{ msg: 'Invalid credentials' }], values: req.body });
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
    req.session.destroy(() => res.redirect('/'));
  });

  // Profile routes
  router.get('/profile', requireAuth, (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
    res.render('profile', { user: req.session.user, profile: user, errors: [] });
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
    res.render('compose', { user: req.session.user, errors: [], values: {} });
  });
  router.post('/compose', requireAuth,
    body('title').isLength({ min: 1, max: 120 }),
    body('body').isLength({ min: 1, max: 50000 }), // Increased to allow images
    (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).render('compose', { user: req.session.user, errors: errors.array(), values: req.body });

      // Enforce 1 letter per 24h
      const last = db.prepare('SELECT created_at FROM letters WHERE author_id = ? ORDER BY created_at DESC LIMIT 1').get(req.session.user.id);
      if (last && dayjs(last.created_at).isAfter(dayjs().subtract(24, 'hour'))) {
        return res.status(429).render('compose', { user: req.session.user, errors: [{ msg: 'You can only post once every 24 hours.' }], values: req.body });
      }

      const publish_at = dayjs().add(12, 'hour').toISOString();
      const info = db.prepare('INSERT INTO letters (author_id, title, body, publish_at, is_published) VALUES (?, ?, ?, ?, 0)')
        .run(req.session.user.id, req.body.title, req.body.body, publish_at);
      eventTracker.track('letter_create', {
        userId: req.session.user.id,
        sessionId: req.sessionID,
        letterId: info.lastInsertRowid,
        metadata: { title: req.body.title, wordCount: req.body.body.split(/\s+/).length }
      });
      res.redirect(`/letters/${info.lastInsertRowid}`);
    }
  );

  router.get('/letters/:id', (req, res) => {
    const id = Number(req.params.id);
    const uid = req.session.user?.id || -1;
    const letter = db.prepare(`
      SELECT l.*, u.handle, u.bio, u.avatar_url,
        (SELECT COUNT(1) FROM resonates r WHERE r.letter_id = l.id) AS resonate_count,
        EXISTS(SELECT 1 FROM resonates r WHERE r.letter_id = l.id AND r.user_id = @uid) AS did_resonate
      FROM letters l JOIN users u ON u.id = l.author_id WHERE l.id = @id
    `).get({ id, uid });
    if (!letter) return res.status(404).send('Not found');

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
    
    const filters = {};
    if (eventType) filters.eventType = eventType;
    
    const events = eventTracker.getRecentEvents(200, filters);
    const analytics = eventTracker.getAnalytics(period);
    
    res.render('admin-events', { 
      user: req.session.user, 
      events, 
      analytics, 
      selectedType: eventType,
      selectedPeriod: period 
    });
  });

  router.get('/admin', requireAdmin, (req, res) => {
    const filter = req.query.filter || 'all';
    
    // Get letters based on filter
    let lettersQuery = `
      SELECT l.*, u.handle, 
        (SELECT COUNT(*) FROM comments WHERE letter_id = l.id) as comment_count,
        (SELECT COUNT(*) FROM resonates WHERE letter_id = l.id) as resonate_count
      FROM letters l 
      JOIN users u ON u.id = l.author_id 
    `;
    
    if (filter === 'pending') {
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
    db.prepare('UPDATE letters SET is_published = 1, publish_at = datetime("now") WHERE id = ?').run(id);
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

  return router;
}

module.exports = { buildRouter };


