const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const AppleStrategy = require('passport-apple');
const Database = require('better-sqlite3');
const path = require('path');

const dbFile = process.env.SQLITE_FILE || path.join(__dirname, '../db/slocial.db');

// Serialize user for session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  const db = new Database(dbFile);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  db.close();
  done(null, user);
});

// Google OAuth Strategy
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback'
  },
  async (accessToken, refreshToken, profile, done) => {
    const db = new Database(dbFile);
    
    try {
      console.log('Google OAuth Profile:', JSON.stringify({
        id: profile.id,
        displayName: profile.displayName,
        emails: profile.emails,
        photos: profile.photos?.length
      }));
      
      // Check if user exists with this Google ID
      let user = db.prepare('SELECT * FROM users WHERE oauth_provider = ? AND oauth_id = ?')
        .get('google', String(profile.id));
      
      if (!user) {
        // Check if email already exists (from regular signup or other OAuth)
        const email = profile.emails[0].value;
        user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email));
        
        if (user) {
          console.log('Linking existing account with Google Sign-In:', user.email);
          // Link existing account with Google - only update if not already linked to another provider
          if (!user.oauth_provider) {
            db.prepare('UPDATE users SET oauth_provider = ?, oauth_id = ?, avatar_url = COALESCE(avatar_url, ?) WHERE id = ?')
              .run('google', String(profile.id), profile.photos?.[0]?.value || null, user.id);
          } else {
            // User already has OAuth from another provider
            console.log('User already has OAuth provider:', user.oauth_provider);
            // Still allow login
          }
        } else {
          // Create new user
          const email = profile.emails[0].value;
          const displayName = profile.displayName || profile.name?.givenName || email.split('@')[0];
          const handle = displayName.toLowerCase().replace(/[^a-z0-9]/g, '') + Math.floor(Math.random() * 1000);
          const info = db.prepare(`
            INSERT INTO users (handle, email, oauth_provider, oauth_id, avatar_url, bio, password_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            handle,
            String(email),
            'google',
            String(profile.id),
            profile.photos?.[0]?.value || null,
            `Google user since ${new Date().getFullYear()}`,
            null  // OAuth users don't need password
          );
          
          user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
        }
      }
      
      db.close();
      return done(null, user);
    } catch (error) {
      db.close();
      return done(error);
    }
  }));
}

// Apple Sign-In Strategy
if (process.env.APPLE_SERVICE_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY) {
  console.log('Apple Sign-In configured with:');
  console.log('- Service ID:', process.env.APPLE_SERVICE_ID);
  console.log('- Team ID:', process.env.APPLE_TEAM_ID);
  console.log('- Key ID:', process.env.APPLE_KEY_ID);
  console.log('- Private Key:', process.env.APPLE_PRIVATE_KEY ? 'Present' : 'Missing');
  console.log('- Callback URL:', process.env.APPLE_CALLBACK_URL || '/auth/apple/callback');
  
  passport.use(new AppleStrategy({
    clientID: process.env.APPLE_SERVICE_ID,
    teamID: process.env.APPLE_TEAM_ID,
    keyID: process.env.APPLE_KEY_ID,
    privateKeyString: process.env.APPLE_PRIVATE_KEY,
    callbackURL: process.env.APPLE_CALLBACK_URL || '/auth/apple/callback',
    passReqToCallback: true
  },
  async (req, accessToken, refreshToken, idToken, profile, done) => {
    const db = new Database(dbFile);
    
    try {
      console.log('Apple Sign-In callback received');
      console.log('ID Token:', idToken ? 'Present' : 'Missing');
      
      if (!idToken || !idToken.sub) {
        console.error('Apple Sign-In: Invalid ID token');
        return done(new Error('Invalid Apple ID token'));
      }
      
      // Apple provides limited info, use the ID token data
      // Note: Apple only provides email on first sign-in, not subsequent ones
      let email = idToken.email;
      const appleId = idToken.sub;
      
      console.log('Apple ID Token details:', {
        sub: idToken.sub,
        email: idToken.email,
        email_verified: idToken.email_verified,
        is_private_email: idToken.is_private_email
      });
      
      // Ensure appleId is a string
      if (!appleId || typeof appleId !== 'string') {
        console.error('Invalid Apple ID:', appleId);
        db.close();
        return done(new Error('Invalid Apple ID received'));
      }
      
      // If no email provided (subsequent sign-ins), try to find user by Apple ID first
      if (!email) {
        const existingUser = db.prepare('SELECT * FROM users WHERE oauth_provider = ? AND oauth_id = ?')
          .get('apple', String(appleId));
        if (existingUser) {
          console.log('Found existing Apple user by ID:', existingUser.email);
          db.close();
          return done(null, existingUser);
        }
        // If no existing user and no email, create a private relay email
        email = `${appleId}@privaterelay.appleid.com`;
      }
      
      console.log('Apple Sign-In data:', { email, appleId });
      
      // Check if user exists with this Apple ID
      let user = db.prepare('SELECT * FROM users WHERE oauth_provider = ? AND oauth_id = ?')
        .get('apple', String(appleId));
      
      if (!user) {
        // Check if email already exists (from regular signup or other OAuth)
        user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email));
        
        if (user) {
          console.log('Linking existing account with Apple Sign-In:', user.email);
          // Link existing account with Apple - only update if not already linked to another provider
          if (!user.oauth_provider) {
            db.prepare('UPDATE users SET oauth_provider = ?, oauth_id = ? WHERE id = ?')
              .run('apple', String(appleId), user.id);
          } else {
            // User already has OAuth from another provider, just add Apple ID
            console.log('User already has OAuth provider:', user.oauth_provider);
            // Still allow login but don't overwrite existing OAuth
          }
        } else {
          // Create new user
          const emailPrefix = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
          const handle = emailPrefix + Math.floor(Math.random() * 1000);
          const info = db.prepare(`
            INSERT INTO users (handle, email, oauth_provider, oauth_id, bio, password_hash)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            handle,
            String(email),
            'apple',
            String(appleId),
            `Apple user since ${new Date().getFullYear()}`,
            null  // OAuth users don't need password
          );
          
          user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
        }
      }
      
      db.close();
      return done(null, user);
    } catch (error) {
      db.close();
      return done(error);
    }
  }));
}

module.exports = passport;
