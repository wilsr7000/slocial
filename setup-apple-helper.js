const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('🍎 Apple Sign-In Configuration Helper\n');
console.log('This will help you add Apple Sign-In credentials to your .env file.\n');
console.log('You\'ll need the following from Apple Developer Console:');
console.log('1. Service ID (e.g., com.slocial.web.service)');
console.log('2. Team ID (10 characters, e.g., D1234567890)');
console.log('3. Key ID (10 characters, e.g., ABC123DEFG)');
console.log('4. Private Key (.p8 file contents)\n');

const questions = [
  { key: 'APPLE_SERVICE_ID', prompt: 'Enter your Service ID: ', default: 'com.slocial.web.service' },
  { key: 'APPLE_TEAM_ID', prompt: 'Enter your Team ID (10 chars): ', default: '' },
  { key: 'APPLE_KEY_ID', prompt: 'Enter your Key ID (10 chars): ', default: '' }
];

let config = {};
let currentIndex = 0;

function askQuestion() {
  if (currentIndex < questions.length) {
    const q = questions[currentIndex];
    const promptText = q.default ? `${q.prompt}[${q.default}] ` : q.prompt;
    
    rl.question(promptText, (answer) => {
      config[q.key] = answer.trim() || q.default;
      currentIndex++;
      askQuestion();
    });
  } else {
    askForPrivateKey();
  }
}

function askForPrivateKey() {
  console.log('\nNow paste your Private Key (.p8 file contents).');
  console.log('Include the BEGIN and END lines.');
  console.log('When done, type "END" on a new line and press Enter:\n');
  
  let privateKey = [];
  
  rl.on('line', (line) => {
    if (line.trim() === 'END') {
      config.APPLE_PRIVATE_KEY = privateKey.join('\n');
      saveConfig();
    } else {
      privateKey.push(line);
    }
  });
}

function saveConfig() {
  const envPath = path.join(__dirname, '.env');
  
  // Read existing .env
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }
  
  // Check if Apple config already exists
  if (envContent.includes('APPLE_SERVICE_ID')) {
    console.log('\n⚠️  Apple configuration already exists in .env');
    rl.question('Do you want to replace it? (y/n): ', (answer) => {
      if (answer.toLowerCase() === 'y') {
        // Remove old Apple config
        envContent = envContent.replace(/\n?# Apple Sign-In[\s\S]*?(?=\n#|\n\n|$)/g, '');
        addAppleConfig(envContent);
      } else {
        console.log('\n❌ Configuration cancelled.');
        rl.close();
      }
    });
  } else {
    addAppleConfig(envContent);
  }
}

function addAppleConfig(envContent) {
  const appleConfig = `
# Apple Sign-In
APPLE_SERVICE_ID=${config.APPLE_SERVICE_ID}
APPLE_TEAM_ID=${config.APPLE_TEAM_ID}
APPLE_KEY_ID=${config.APPLE_KEY_ID}
APPLE_PRIVATE_KEY="${config.APPLE_PRIVATE_KEY}"
APPLE_CALLBACK_URL=http://localhost:3000/auth/apple/callback
`;

  const newContent = envContent + appleConfig;
  fs.writeFileSync(path.join(__dirname, '.env'), newContent);
  
  console.log('\n✅ Apple Sign-In configuration added to .env!');
  console.log('\n📋 For Production (Render), add these environment variables:');
  console.log(`   APPLE_SERVICE_ID=${config.APPLE_SERVICE_ID}`);
  console.log(`   APPLE_TEAM_ID=${config.APPLE_TEAM_ID}`);
  console.log(`   APPLE_KEY_ID=${config.APPLE_KEY_ID}`);
  console.log(`   APPLE_PRIVATE_KEY=[your private key]`);
  console.log(`   APPLE_CALLBACK_URL=https://slocial.onrender.com/auth/apple/callback`);
  console.log('\n🎉 Restart your server to apply changes!');
  
  rl.close();
}

// Start the questionnaire
askQuestion();
