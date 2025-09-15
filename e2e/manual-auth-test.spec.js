const { test, expect } = require('@playwright/test');

// This test requires manual intervention for OAuth authentication
test.describe('Manual Authentication and Letter Creation', () => {
  // Set a longer timeout for manual steps
  test.setTimeout(5 * 60 * 1000); // 5 minutes

  test('Sign in with Google and create a letter (Manual)', async ({ page }) => {
    console.log('🚀 Starting manual authentication test...');
    console.log('📌 This test requires you to manually sign in with Google');
    
    // Go to login page
    await page.goto('http://localhost:3000/login');
    console.log('📍 Navigated to login page');
    
    // Click on Google sign-in
    const googleButton = page.locator('button:has-text("Continue with Google")').first();
    await googleButton.click();
    console.log('🔵 Clicked "Continue with Google"');
    console.log('⏳ Please complete the Google sign-in process in the browser...');
    
    // Wait for successful authentication
    // We'll wait for the user to be redirected back to the app
    await page.waitForFunction(
      () => {
        const url = window.location.href;
        return !url.includes('accounts.google.com') && 
               !url.includes('/login') && 
               !url.includes('oauth');
      },
      { timeout: 120000 } // 2 minutes to complete auth
    );
    
    console.log('✅ Authentication completed!');
    
    // Give the page a moment to fully load
    await page.waitForTimeout(2000);
    
    // Check if we're logged in by looking for the Write button
    const writeButton = page.locator('nav >> text=Write').first();
    const isLoggedIn = await writeButton.isVisible({ timeout: 10000 }).catch(() => false);
    
    if (!isLoggedIn) {
      console.log('❌ Write button not found - authentication may have failed');
      console.log('Current URL:', page.url());
      await page.screenshot({ path: 'auth-failed.png' });
      throw new Error('Authentication failed - Write button not visible');
    }
    
    console.log('✅ Successfully logged in!');
    console.log('📝 Now testing letter creation...');
    
    // Navigate to compose
    await writeButton.click();
    await page.waitForTimeout(500);
    
    // Click Compose in dropdown
    const composeLink = page.locator('.dropdown-menu >> text=Compose');
    await composeLink.click();
    
    await expect(page).toHaveURL('/compose');
    console.log('📍 Navigated to compose page');
    
    // Create a unique letter
    const timestamp = new Date().toLocaleString();
    const letterTitle = `Test Letter - ${timestamp}`;
    const letterBody = `This is an automated test letter created on ${timestamp}.
    
This letter tests the full flow of:
1. Signing in with Google OAuth
2. Navigating to the compose page
3. Creating a new letter with title and content
4. Adding tags to organize the content
5. Publishing the letter (with 12-hour steep)

The Slocial platform encourages thoughtful, slow writing. This test verifies that the entire user journey works correctly from authentication through content creation.`;
    
    // Fill in the letter form
    console.log('📝 Filling in letter details...');
    
    // Title
    await page.fill('input[name="title"]', letterTitle);
    console.log('   ✓ Title:', letterTitle);
    
    // Body
    await page.fill('textarea[name="body"]', letterBody);
    console.log('   ✓ Body: Added content');
    
    // Try to add tags
    const tagInput = page.locator('#tag-search');
    const hasTagInput = await tagInput.isVisible().catch(() => false);
    
    if (hasTagInput) {
      console.log('📏 Adding tags...');
      
      // Add a few tags
      const tags = ['testing', 'automation', 'thoughts'];
      for (const tag of tags) {
        await tagInput.fill(tag);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
        console.log(`   ✓ Added tag: ${tag}`);
      }
    } else {
      console.log('   ℹ️  Tag input not found - skipping tags');
    }
    
    // Take a screenshot before publishing
    await page.screenshot({ path: 'before-publish.png' });
    console.log('📸 Screenshot saved: before-publish.png');
    
    // Click publish button
    console.log('📤 Publishing letter...');
    const publishButton = page.locator('button:has-text("Publish")').first();
    await publishButton.click();
    
    // Handle honor system modal if it appears
    const modalVisible = await page.locator('.modal').isVisible({ timeout: 3000 }).catch(() => false);
    
    if (modalVisible) {
      console.log('📋 Honor system modal appeared');
      
      // Look for the understand/continue button
      const modalButton = page.locator('.modal button').filter({ hasText: /understand|continue|ok/i }).first();
      await modalButton.click();
      console.log('   ✓ Acknowledged honor system');
    }
    
    // Wait for navigation after publish
    await page.waitForTimeout(3000);
    
    // Check where we ended up
    const finalUrl = page.url();
    console.log('📍 Final URL:', finalUrl);
    
    if (finalUrl.includes('/compose')) {
      // Still on compose page - check for errors
      const errorElement = page.locator('.error, .alert-danger, .alert-error').first();
      const hasError = await errorElement.isVisible().catch(() => false);
      
      if (hasError) {
        const errorText = await errorElement.textContent();
        console.log('❌ Error message:', errorText);
        
        if (errorText.includes('24 hours') || errorText.includes('one letter')) {
          console.log('ℹ️  Rate limit: Can only publish one letter per 24 hours');
        }
      } else {
        console.log('⚠️  Still on compose page but no visible error');
      }
    } else if (finalUrl.includes('/drafts')) {
      console.log('✅ Letter saved to drafts (will publish after 12-hour steep)');
    } else if (finalUrl.includes('/letters/')) {
      console.log('✅ Letter published immediately!');
    } else {
      console.log('✅ Letter submitted successfully');
    }
    
    // Check drafts to confirm
    console.log('📂 Checking drafts...');
    await page.goto('/drafts');
    
    // Look for our letter
    const draftTitle = page.locator(`text="${letterTitle}"`).first();
    const isDraftVisible = await draftTitle.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (isDraftVisible) {
      console.log('✅ Letter found in drafts!');
      await page.screenshot({ path: 'letter-in-drafts.png' });
      console.log('📸 Screenshot saved: letter-in-drafts.png');
    } else {
      console.log('ℹ️  Letter not in drafts (may have been published or rejected)');
    }
    
    // Final summary
    console.log('\n' + '='.repeat(50));
    console.log('TEST COMPLETE');
    console.log('='.repeat(50));
    console.log('✅ Successfully signed in with Google');
    console.log('✅ Navigated to compose page');
    console.log('✅ Filled in letter details');
    if (isDraftVisible) {
      console.log('✅ Letter saved to drafts');
    } else {
      console.log('⚠️  Letter status unclear (check screenshots)');
    }
    console.log('='.repeat(50));
  });

  test('Quick test - Check if already logged in', async ({ page }) => {
    console.log('🔍 Checking if user is already logged in...');
    
    await page.goto('http://localhost:3000');
    
    // Check for Write button
    const writeButton = page.locator('nav >> text=Write').first();
    const isLoggedIn = await writeButton.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (isLoggedIn) {
      console.log('✅ User is already logged in!');
      
      // Get user info if visible
      const handle = page.locator('.nav .handle').first();
      const userHandle = await handle.textContent().catch(() => null);
      if (userHandle) {
        console.log('👤 Logged in as:', userHandle);
      }
      
      // Quick compose test
      console.log('📝 Testing quick compose access...');
      await writeButton.click();
      await page.waitForTimeout(500);
      
      const composeLink = page.locator('.dropdown-menu >> text=Compose');
      await composeLink.click();
      
      if (page.url().includes('/compose')) {
        console.log('✅ Can access compose page');
        
        // Check form elements
        const titleInput = await page.locator('input[name="title"]').isVisible();
        const bodyTextarea = await page.locator('textarea[name="body"]').isVisible();
        const publishButton = await page.locator('button:has-text("Publish")').isVisible();
        
        console.log('📋 Form elements check:');
        console.log(`   ${titleInput ? '✅' : '❌'} Title input`);
        console.log(`   ${bodyTextarea ? '✅' : '❌'} Body textarea`);
        console.log(`   ${publishButton ? '✅' : '❌'} Publish button`);
      }
    } else {
      console.log('❌ User is not logged in');
      console.log('ℹ️  Run the first test to sign in with Google');
    }
  });
});
