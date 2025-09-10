const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const dayjs = require('dayjs');

function buildRouter(db) {
  const router = express.Router();

  function requireAuth(req, res, next) {
    if (!req.session.user) return res.redirect('/login');
    next();
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
        req.session.user = { id: info.lastInsertRowid, handle, email };
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
      req.session.user = { id: user.id, handle: user.handle, email: user.email };
      res.redirect('/');
    }
  );

  router.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
  });

  router.get('/compose', requireAuth, (req, res) => {
    res.render('compose', { user: req.session.user, errors: [], values: {} });
  });
  router.post('/compose', requireAuth,
    body('title').isLength({ min: 1, max: 120 }),
    body('body').isLength({ min: 1, max: 5000 }),
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
      res.redirect(`/letters/${info.lastInsertRowid}`);
    }
  );

  router.get('/letters/:id', (req, res) => {
    const id = Number(req.params.id);
    const uid = req.session.user?.id || -1;
    const letter = db.prepare(`
      SELECT l.*, u.handle,
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

    res.render('letter', { user: req.session.user, letter, comments });
  });

  router.post('/letters/:id/resonate', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    try {
      db.prepare('INSERT OR IGNORE INTO resonates (letter_id, user_id) VALUES (?, ?)').run(id, req.session.user.id);
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
        db.prepare('INSERT INTO comments (letter_id, author_id, body) VALUES (?, ?, ?)').run(id, req.session.user.id, req.body.body);
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

  return router;
}

module.exports = { buildRouter };


