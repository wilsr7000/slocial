require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const { initializeDatabase } = require('./db/init');
const { baseMiddleware } = require('./middleware');
const { buildRouter } = require('./routes');
const ejsLayouts = require('express-ejs-layouts');
const csrf = require('csurf');
const eventTracker = require('./services/eventTracker');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(ejsLayouts);
app.set('layout', 'layout');

baseMiddleware(app);

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, 'db') }),
  secret: process.env.SESSION_SECRET || 'development-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 },
}));

const db = initializeDatabase();

// Auto-create default admin on first run
const { execSync } = require('child_process');
try {
  const adminExists = db.prepare('SELECT id FROM users WHERE email = ?').get('robb@onereach.com');
  if (!adminExists) {
    execSync('node src/db/setup-admin.js', { stdio: 'inherit' });
  }
} catch (e) {
  // Silent fail if setup-admin has issues
}

// Inject locals and track events
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  
  // Track page view start
  if (req.method === 'GET' && !req.path.startsWith('/public/')) {
    eventTracker.startPageView(req.sessionID, req.path);
    
    // Track visitor event for new sessions
    if (!req.session.hasVisited) {
      req.session.hasVisited = true;
      eventTracker.track('visitor', {
        sessionId: req.sessionID,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        path: req.path,
        metadata: { referrer: req.get('referrer') || 'direct' }
      });
    }
    
    // Override res.render to track page view completion
    const originalRender = res.render.bind(res);
    res.render = function(...args) {
      // Track page view end when rendering completes
      res.on('finish', () => {
        eventTracker.endPageView(
          req.sessionID,
          req.path,
          req.session.user?.id,
          req.ip,
          req.get('user-agent')
        );
      });
      return originalRender(...args);
    };
  }
  
  next();
});

// CSRF protection
app.use(csrf());
app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  next();
});

app.use(buildRouter(db));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Slocial listening on http://localhost:${port}`);
});

// Background publisher: check every 5 minutes
setInterval(() => {
  try {
    const nowIso = new Date().toISOString();
    const info = db.prepare('UPDATE letters SET is_published = 1 WHERE is_published = 0 AND publish_at <= ?').run(nowIso);
    if (info.changes) {
      console.log(`Published ${info.changes} letters`);
    }
  } catch (e) {
    console.error('Publish interval error', e);
  }
}, 5 * 60 * 1000);

// CSRF error handler
app.use((err, req, res, next) => {
  if (err && err.code === 'EBADCSRFTOKEN') {
    return res.status(403).send('Form has expired. Please go back and try again.');
  }
  next(err);
});


