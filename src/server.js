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
const passport = require('./auth/passport-config');

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

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

const db = initializeDatabase();

// Run inline migration to add draft columns
console.log('Checking database schema...');
try {
  const columns = db.prepare("PRAGMA table_info(letters)").all();
  const hasIsDraft = columns.some(col => col.name === 'is_draft');
  const hasLastSavedAt = columns.some(col => col.name === 'last_saved_at');
  
  if (!hasIsDraft) {
    console.log('Adding is_draft column to letters table...');
    db.prepare('ALTER TABLE letters ADD COLUMN is_draft INTEGER NOT NULL DEFAULT 0').run();
    console.log('✓ is_draft column added');
  }
  
  if (!hasLastSavedAt) {
    console.log('Adding last_saved_at column to letters table...');
    db.prepare('ALTER TABLE letters ADD COLUMN last_saved_at TEXT').run();
    console.log('✓ last_saved_at column added');
  }
  
  // Create index for drafts if it doesn't exist
  try {
    db.prepare('CREATE INDEX idx_letters_drafts ON letters(author_id, is_draft, created_at DESC)').run();
    console.log('✓ Draft index created');
  } catch (e) {
    // Index might already exist, that's ok
  }
  
  console.log('Database schema check complete');
} catch (e) {
  console.error('Migration error:', e);
}

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
  
  // Track ALL HTTP requests (not just page views)
  const isStaticAsset = req.path.startsWith('/public/') || 
                        req.path.startsWith('/css/') || 
                        req.path.startsWith('/js/') ||
                        req.path.endsWith('.ico');
  
  if (!isStaticAsset) {
    // Track the request immediately
    eventTracker.track('web_request', {
      sessionId: req.sessionID,
      userId: req.session.user?.id || null,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      path: req.path,
      method: req.method,
      metadata: {
        referrer: req.get('referrer') || 'direct',
        query: req.query,
        isAuthenticated: !!req.session.user,
        userHandle: req.session.user?.handle
      }
    });
    
    // Track visitor event for new sessions
    if (!req.session.hasVisited) {
      req.session.hasVisited = true;
      eventTracker.track('new_visitor', {
        sessionId: req.sessionID,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        path: req.path,
        metadata: { 
          referrer: req.get('referrer') || 'direct',
          landingPage: req.path,
          timestamp: new Date().toISOString()
        }
      });
    }
    
    // Track page view timing for GET requests
    if (req.method === 'GET') {
      const startTime = Date.now();
      eventTracker.startPageView(req.sessionID, req.path);
      
      // Track response time and status
      const originalSend = res.send.bind(res);
      const originalRender = res.render.bind(res);
      const originalJson = res.json.bind(res);
      
      const trackResponse = () => {
        const duration = Date.now() - startTime;
        eventTracker.track('page_view', {
          sessionId: req.sessionID,
          userId: req.session.user?.id || null,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          path: req.path,
          method: 'GET',
          durationMs: duration,
          metadata: {
            statusCode: res.statusCode,
            referrer: req.get('referrer') || 'direct',
            isAuthenticated: !!req.session.user
          }
        });
      };
      
      res.send = function(...args) {
        trackResponse();
        return originalSend(...args);
      };
      
      res.render = function(...args) {
        trackResponse();
        return originalRender(...args);
      };
      
      res.json = function(...args) {
        trackResponse();
        return originalJson(...args);
      };
    }
  }
  
  next();
});

// CSRF protection with Apple Sign-In exception
const csrfProtection = csrf();
app.use((req, res, next) => {
  // Skip CSRF for Apple Sign-In callback (uses POST)
  if (req.path === '/auth/apple/callback') {
    return next();
  }
  csrfProtection(req, res, next);
});
app.use((req, res, next) => {
  if (req.path === '/auth/apple/callback') {
    res.locals.csrfToken = '';
  } else {
    res.locals.csrfToken = req.csrfToken ? req.csrfToken() : '';
  }
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

// Error handlers
app.use((err, req, res, next) => {
  // CSRF error
  if (err && err.code === 'EBADCSRFTOKEN') {
    console.error('CSRF token error:', req.path);
    return res.status(403).send('Form has expired. Please go back and try again.');
  }
  
  // Body size error
  if (err && err.type === 'entity.too.large') {
    console.error('Request body too large:', req.path);
    return res.status(413).send('Request body too large. Please reduce the size of your content or images.');
  }
  
  // General error logging
  console.error('Server error:', err);
  console.error('Stack:', err.stack);
  
  // Send error response
  res.status(err.status || 500).send('Internal Server Error');
});


