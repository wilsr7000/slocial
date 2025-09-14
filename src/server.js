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

// Run inline migration to add draft columns (v2)
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

// Run migration for slocialite features (v3)
console.log('Checking for slocialite features...');
try {
  // Add is_slocialite column to users table
  const userColumns = db.prepare("PRAGMA table_info(users)").all();
  const hasIsSlocialite = userColumns.some(col => col.name === 'is_slocialite');
  
  if (!hasIsSlocialite) {
    console.log('Adding is_slocialite column to users table...');
    db.prepare('ALTER TABLE users ADD COLUMN is_slocialite INTEGER NOT NULL DEFAULT 0').run();
    console.log('✓ is_slocialite column added');
  }
  
  // Add approval columns to letters table
  const letterColumns = db.prepare("PRAGMA table_info(letters)").all();
  const hasApprovalStatus = letterColumns.some(col => col.name === 'approval_status');
  const hasApprovedBy = letterColumns.some(col => col.name === 'approved_by');
  const hasApprovedAt = letterColumns.some(col => col.name === 'approved_at');
  const hasRejectionReason = letterColumns.some(col => col.name === 'rejection_reason');
  const hasFormat = letterColumns.some(col => col.name === 'format');
  
  if (!hasApprovalStatus) {
    console.log('Adding approval_status column to letters table...');
    db.prepare(`ALTER TABLE letters ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved' CHECK(approval_status IN ('pending', 'approved', 'rejected'))`).run();
    console.log('✓ approval_status column added');
  }
  
  if (!hasApprovedBy) {
    console.log('Adding approved_by column to letters table...');
    db.prepare('ALTER TABLE letters ADD COLUMN approved_by INTEGER REFERENCES users(id)').run();
    console.log('✓ approved_by column added');
  }
  
  if (!hasApprovedAt) {
    console.log('Adding approved_at column to letters table...');
    db.prepare('ALTER TABLE letters ADD COLUMN approved_at TEXT').run();
    console.log('✓ approved_at column added');
  }
  
  if (!hasRejectionReason) {
    console.log('Adding rejection_reason column to letters table...');
    db.prepare('ALTER TABLE letters ADD COLUMN rejection_reason TEXT').run();
    console.log('✓ rejection_reason column added');
  }
  
  if (!hasFormat) {
    console.log('Adding format column to letters table...');
    db.prepare(`ALTER TABLE letters ADD COLUMN format TEXT DEFAULT 'standard'`).run();
    console.log('✓ format column added for writing constraints');
  }
  
  // Create index for moderation queue
  try {
    db.prepare('CREATE INDEX idx_letters_moderation ON letters(approval_status, created_at DESC)').run();
    console.log('✓ Moderation index created');
  } catch (e) {
    // Index might already exist, that's ok
  }
  
  console.log('Slocialite features check complete');
} catch (err) {
  console.error('Slocialite migration error:', err);
  // Continue anyway
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

// Helper function for auto-linking URLs in text
function autoLinkUrls(text) {
  if (!text) return '';
  
  // Escape HTML first
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
  
  // Then auto-link URLs
  const urlRegex = /(https?:\/\/[^\s<]+)/g;
  return escaped.replace(urlRegex, (url) => {
    // Clean up URL (remove trailing punctuation)
    let cleanUrl = url;
    let trailing = '';
    const match = url.match(/^(.*?)([\.,;:!?\)]+)$/);
    if (match) {
      cleanUrl = match[1];
      trailing = match[2];
    }
    
    // Truncate display text if too long
    let displayUrl = cleanUrl;
    if (cleanUrl.length > 30) {
      displayUrl = cleanUrl.substring(0, 27) + '...';
    }
    
    return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="auto-link">${displayUrl}</a>${trailing}`;
  });
}

// Inject locals and track events
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.theme = req.cookies?.theme || 'light';
  res.locals.autoLink = autoLinkUrls; // Make helper available in views
  
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
    
    // Track page view timing for GET requests (exclude static assets and API)
    const shouldTrackPageView = req.method === 'GET' && 
      !req.path.startsWith('/static/') && 
      !req.path.startsWith('/api/') &&
      !req.path.endsWith('.css') &&
      !req.path.endsWith('.js') &&
      !req.path.endsWith('.png') &&
      !req.path.endsWith('.jpg') &&
      !req.path.endsWith('.ico') &&
      !req.path.includes('/favicon');
      
    if (shouldTrackPageView) {
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
  // For multipart forms, check CSRF token from query parameter
  if ((req.path === '/tags/create' || req.path.match(/^\/tags\/\d+\/edit$/)) && req.method === 'POST') {
    // Move CSRF token from query to body for the middleware to validate
    if (req.query._csrf) {
      req.body = req.body || {};
      req.body._csrf = req.query._csrf;
    }
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


