const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');

// Google OAuth configuration
const GOOGLE_CLIENT_ID = '885454102326-3if1hdmdfb7nq5capjcq49qejuilkqfa.apps.googleusercontent.com';

console.log('🔐 Setting up OAuth configuration...\n');

// Check if .env exists
let envContent = '';
if (fs.existsSync(envPath)) {
  envContent = fs.readFileSync(envPath, 'utf8');
  console.log('✓ Found existing .env file');
} else {
  console.log('✓ Creating new .env file');
}

// Check if Google OAuth is already configured
if (envContent.includes('GOOGLE_CLIENT_ID')) {
  console.log('⚠️  Google OAuth already configured in .env');
} else {
  // Add Google OAuth configuration
  const googleConfig = `
# Google OAuth
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_CLIENT_SECRET_HERE
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
`;

  // If .env is empty or doesn't have basic config, add it
  if (!envContent) {
    envContent = `# Session Secret
SESSION_SECRET=slocial-secret-key-2025-change-this-in-production

# Database
SQLITE_FILE=./src/db/slocial.db

# Admin Email
ADMIN_EMAIL=robb@onereach.com

# Port
PORT=3000
${googleConfig}`;
  } else {
    envContent += googleConfig;
  }

  fs.writeFileSync(envPath, envContent);
  console.log('✓ Added Google OAuth configuration to .env');
}

console.log('\n📋 Next Steps:');
console.log('1. Get your Client Secret from Google Cloud Console:');
console.log('   https://console.cloud.google.com/apis/credentials');
console.log('');
console.log('2. Edit .env and replace YOUR_GOOGLE_CLIENT_SECRET_HERE with your actual secret');
console.log('');
console.log('3. In Google Cloud Console, make sure you have these Authorized redirect URIs:');
console.log('   - http://localhost:3000/auth/google/callback (for local development)');
console.log('   - https://slocial.onrender.com/auth/google/callback (for production)');
console.log('');
console.log('4. For production deployment on Render:');
console.log('   - Add these environment variables in Render dashboard:');
console.log('   - GOOGLE_CLIENT_ID=' + GOOGLE_CLIENT_ID);
console.log('   - GOOGLE_CLIENT_SECRET=<your-secret>');
console.log('   - GOOGLE_CALLBACK_URL=https://slocial.onrender.com/auth/google/callback');
console.log('');
console.log('✅ Setup complete! Restart your server to apply changes.');
