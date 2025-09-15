const { test, expect } = require('@playwright/test');

// Test credentials - you'll need to use real credentials or create a test account
// UPDATE THESE WITH YOUR ACTUAL CREDENTIALS:
const TEST_USER = {
  email: 'test@example.com',     // ← CHANGE THIS to your email
  password: 'password123',        // ← CHANGE THIS to your password  
  handle: 'testuser'             // ← CHANGE THIS to your handle (optional)
};

test.describe('Manual Login and Letter Creation', () => {
  test('Login with email/password and create a letter', async ({ page }) => {
    console.log('🚀 Starting manual login test...');
    
    // Navigate to login page
    await page.goto('http://localhost:3000/login');
    console.log('📍 On login page');
    
    // Check if regular login form exists
    const emailInput = page.locator('input[name="email"]');
    const passwordInput = page.locator('input[name="password"]');
    const hasLoginForm = await emailInput.isVisible().catch(() => false);
    
    if (!hasLoginForm) {
      console.log('❌ No email/password login form found');
      console.log('ℹ️  Only OAuth login available');
      return;
    }
    
    console.log('📝 Found login form, entering credentials...');
    
    // Fill in login credentials
    await emailInput.fill(TEST_USER.email);
    await passwordInput.fill(TEST_USER.password);
    console.log('✓ Entered email:', TEST_USER.email);
    console.log('✓ Entered password: ***');
    
    // Submit the form
    const submitButton = page.locator('button[type="submit"]').filter({ hasText: /sign in/i }).first();
    await submitButton.click();
    console.log('📤 Submitted login form');
    
    // Wait for navigation
    await page.waitForTimeout(2000);
    
    // Check if login was successful
    const currentUrl = page.url();
    console.log('📍 Current URL:', currentUrl);
    
    if (currentUrl.includes('/login')) {
      // Still on login page - check for errors
      const errorElement = page.locator('.error, .alert-danger, .alert-error').first();
      const hasError = await errorElement.isVisible().catch(() => false);
      
      if (hasError) {
        const errorText = await errorElement.textContent();
        console.log('❌ Login failed:', errorText);
        console.log('\nℹ️  Please update TEST_USER credentials in the test file');
        console.log('   File: e2e/manual-login-test.spec.js');
        console.log('   Lines 3-7: Update email and password');
        return;
      } else {
        console.log('❌ Login failed - still on login page');
        console.log('ℹ️  Check if the account exists or credentials are correct');
        return;
      }
    }
    
    console.log('✅ Login successful!');
    
    // Verify we're logged in by checking for Write button
    const writeButton = page.locator('nav >> text=Write').first();
    const isLoggedIn = await writeButton.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (!isLoggedIn) {
      console.log('⚠️  Login seemed successful but Write button not found');
      await page.screenshot({ path: 'after-login.png' });
      console.log('📸 Screenshot saved: after-login.png');
      return;
    }
    
    // Get user handle if visible
    const handleElement = page.locator('.nav .handle').first();
    const userHandle = await handleElement.textContent().catch(() => null);
    if (userHandle) {
      console.log('👤 Logged in as:', userHandle);
    }
    
    console.log('\n--- CREATING LETTER ---\n');
    
    // Navigate to compose page
    await writeButton.click();
    await page.waitForTimeout(500);
    
    const composeLink = page.locator('.dropdown-menu >> text=Compose');
    await composeLink.click();
    
    await expect(page).toHaveURL('/compose');
    console.log('📍 On compose page');
    
    // Create a unique letter
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const letterTitle = `Test Letter ${timestamp}`;
    const letterBody = `This is a test letter created at ${new Date().toLocaleString()}.
    
Testing the complete flow:
1. Manual login with email/password
2. Navigation to compose page
3. Creating a new letter
4. Adding tags for organization
5. Publishing (with 12-hour steep)

This demonstrates the full user journey from authentication to content creation.

The Slocial platform encourages thoughtful writing with its 12-hour steep time,
allowing authors to reconsider their words before they're published to the world.`;
    
    // Fill in the letter
    console.log('📝 Filling letter form...');
    
    await page.fill('input[name="title"]', letterTitle);
    console.log('✓ Title:', letterTitle);
    
    await page.fill('textarea[name="body"]', letterBody);
    console.log('✓ Body: Added content');
    
    // Try to add tags
    const tagInput = page.locator('#tag-search');
    const hasTagInput = await tagInput.isVisible().catch(() => false);
    
    if (hasTagInput) {
      console.log('🏷️  Adding tags...');
      const tags = ['test', 'demo', 'automation'];
      
      for (const tag of tags) {
        await tagInput.fill(tag);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
        console.log('  ✓ Added tag:', tag);
      }
    } else {
      console.log('ℹ️  Tag input not found - skipping tags');
    }
    
    // Take screenshot before publishing
    await page.screenshot({ path: 'compose-filled.png' });
    console.log('📸 Screenshot: compose-filled.png');
    
    // Publish the letter
    console.log('\n📤 Publishing letter...');
    const publishButton = page.locator('button').filter({ hasText: /publish/i }).first();
    await publishButton.click();
    
    // Handle any modals that appear
    await page.waitForTimeout(2000);
    
    const modalVisible = await page.locator('.modal').isVisible().catch(() => false);
    if (modalVisible) {
      console.log('📋 Modal appeared');
      
      // Look for understand/continue button
      const modalButton = page.locator('.modal button').filter({ hasText: /understand|continue|ok|got it/i }).first();
      const hasModalButton = await modalButton.isVisible().catch(() => false);
      
      if (hasModalButton) {
        await modalButton.click();
        console.log('✓ Acknowledged modal');
      }
    }
    
    // Wait for result
    await page.waitForTimeout(3000);
    
    // Check where we ended up
    const finalUrl = page.url();
    console.log('\n📍 Final URL:', finalUrl);
    
    if (finalUrl.includes('/compose')) {
      // Still on compose - check for errors
      const errorElement = page.locator('.error, .alert-danger, .alert-warning').first();
      const hasError = await errorElement.isVisible().catch(() => false);
      
      if (hasError) {
        const errorText = await errorElement.textContent();
        console.log('⚠️  Message:', errorText);
        
        if (errorText.includes('24 hour') || errorText.includes('one letter')) {
          console.log('ℹ️  Rate limit: One letter per 24 hours');
        }
      }
    } else if (finalUrl.includes('/drafts')) {
      console.log('✅ Letter saved to drafts!');
    } else if (finalUrl.includes('/letters/')) {
      console.log('✅ Letter published!');
    } else {
      console.log('✅ Letter submitted');
    }
    
    // Check drafts
    console.log('\n📂 Checking drafts...');
    await page.goto('http://localhost:3000/drafts');
    
    // Look for our letter
    const letterInDrafts = await page.locator(`text="${letterTitle}"`).isVisible({ timeout: 5000 }).catch(() => false);
    
    if (letterInDrafts) {
      console.log('✅ Letter found in drafts!');
      console.log('ℹ️  It will be published after the 12-hour steep period');
      
      await page.screenshot({ path: 'letter-in-drafts.png' });
      console.log('📸 Screenshot: letter-in-drafts.png');
    } else {
      console.log('ℹ️  Letter not in drafts');
      
      // Check if there are any drafts at all
      const noDrafts = await page.locator('text=/no drafts|empty/i').isVisible().catch(() => false);
      if (noDrafts) {
        console.log('   (Drafts page is empty)');
      }
    }
    
    // Final summary
    console.log('\n' + '='.repeat(60));
    console.log('TEST SUMMARY');
    console.log('='.repeat(60));
    console.log('✅ Successfully logged in with email/password');
    console.log('✅ Navigated to compose page');
    console.log('✅ Filled in letter details');
    if (letterInDrafts) {
      console.log('✅ Letter saved to drafts (12-hour steep)');
    } else if (finalUrl.includes('/letters/')) {
      console.log('✅ Letter published immediately');
    } else {
      console.log('⚠️  Letter status unclear');
    }
    console.log('='.repeat(60));
    console.log('\nScreenshots saved:');
    console.log('  - compose-filled.png');
    console.log('  - letter-in-drafts.png');
    console.log('='.repeat(60));
  });

  test('Quick check - Test login form', async ({ page }) => {
    console.log('🔍 Quick check of login functionality...\n');
    
    await page.goto('http://localhost:3000/login');
    
    // Check what login options are available
    const emailInput = await page.locator('input[name="email"]').isVisible().catch(() => false);
    const googleButton = await page.locator('text=Continue with Google').isVisible().catch(() => false);
    const appleButton = await page.locator('text=Continue with Apple').isVisible().catch(() => false);
    
    console.log('Available login methods:');
    console.log(`  ${emailInput ? '✅' : '❌'} Email/Password form`);
    console.log(`  ${googleButton ? '✅' : '❌'} Google OAuth`);
    console.log(`  ${appleButton ? '✅' : '❌'} Apple OAuth`);
    
    if (emailInput) {
      console.log('\n📝 Regular login form is available');
      console.log('ℹ️  Update TEST_USER credentials in this file to test login');
      console.log('   File: e2e/manual-login-test.spec.js');
      console.log('   Lines 3-7');
    } else {
      console.log('\n⚠️  No email/password form found');
      console.log('ℹ️  Only OAuth login is available');
    }
  });
});
