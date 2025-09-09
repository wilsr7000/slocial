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

// Inject locals
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
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


