const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('🔧 Apple Private Key Fix\n');
console.log('This will help you properly add your Apple private key to .env\n');

// First, check if the .p8 file exists in common locations
const possiblePaths = [
  path.join(process.env.HOME, 'Downloads', 'AuthKey_4H8424S9YC.p8'),
  path.join(process.env.HOME, 'Desktop', 'AuthKey_4H8424S9YC.p8'),
  path.join(process.cwd(), 'AuthKey_4H8424S9YC.p8'),
];

let foundPath = null;
for (const p of possiblePaths) {
  if (fs.existsSync(p)) {
    foundPath = p;
    break;
  }
}

if (foundPath) {
  console.log(`✅ Found your .p8 file at: ${foundPath}\n`);
  rl.question('Use this file? (y/n): ', (answer) => {
    if (answer.toLowerCase() === 'y') {
      updateEnvWithKey(foundPath);
    } else {
      askForPath();
    }
  });
} else {
  console.log('Could not find AuthKey_4H8424S9YC.p8 automatically.\n');
  askForPath();
}

function askForPath() {
  rl.question('Enter the full path to your .p8 file: ', (filePath) => {
    filePath = filePath.trim().replace(/^~/, process.env.HOME);
    if (fs.existsSync(filePath)) {
      updateEnvWithKey(filePath);
    } else {
      console.log('❌ File not found. Please check the path and try again.');
      askForPath();
    }
  });
}

function updateEnvWithKey(keyPath) {
  try {
    // Read the private key
    const privateKey = fs.readFileSync(keyPath, 'utf8').trim();
    
    // Validate it looks like a private key
    if (!privateKey.includes('BEGIN PRIVATE KEY')) {
      console.log('❌ This doesn\'t look like a valid .p8 file');
      rl.close();
      return;
    }
    
    // Read current .env
    const envPath = path.join(__dirname, '.env');
    let envContent = fs.readFileSync(envPath, 'utf8');
    
    // Replace the APPLE_PRIVATE_KEY line
    envContent = envContent.replace(
      /APPLE_PRIVATE_KEY=".*?"/s,
      `APPLE_PRIVATE_KEY="${privateKey}"`
    );
    
    // Write back
    fs.writeFileSync(envPath, envContent);
    
    console.log('\n✅ Private key successfully updated in .env!');
    console.log('\n📋 Your Apple Sign-In configuration:');
    console.log('   Service ID: com.slocial.slocial.service');
    console.log('   Team ID: 6KTEPA3LSD');
    console.log('   Key ID: 4H8424S9YC');
    console.log('   Private Key: ✅ Properly configured');
    console.log('\n🎉 Restart your server to test Apple Sign-In!');
    console.log('   npm run dev');
    
  } catch (error) {
    console.log('❌ Error updating .env:', error.message);
  }
  
  rl.close();
}
