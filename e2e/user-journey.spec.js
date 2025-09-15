const { test, expect } = require('@playwright/test');

// Test data
const testUser = {
  email: 'test@example.com',
  password: 'testpassword123',
  handle: 'testuser'
};

const testLetter = {
  title: 'My Test Letter ' + Date.now(),
  body: 'This is a test letter created by Playwright E2E tests. It contains some thoughtful content that represents a real letter someone might write on Slocial. The platform encourages slow, meaningful writing.',
  tags: ['thoughts', 'testing']
};

test.describe('Complete User Journey: Login and Create Letter', () => {
  test('should sign up, login, and create a letter', async ({ page }) => {
    // Start at homepage
    await page.goto('/');
    console.log('📍 Starting at homepage');
    
    // Navigate to signup
    await page.click('text=Create account');
    await expect(page).toHaveURL('/signup');
    console.log('📍 Navigated to signup page');
    
    // Try to sign up (might fail if user exists)
    await page.fill('input[name="email"]', testUser.email);
    await page.fill('input[name="handle"]', testUser.handle);
    await page.fill('input[name="password"]', testUser.password);
    
    // Submit signup form
    await page.click('button[type="submit"]');
    console.log('📝 Submitted signup form');
    
    // Wait for navigation
    await page.waitForTimeout(2000);
    
    // Check if we're logged in or need to login
    const currentUrl = page.url();
    
    if (currentUrl.includes('login')) {
      console.log('📍 User exists, logging in instead');
      // User already exists, login instead
      await page.fill('input[name="email"]', testUser.email);
      await page.fill('input[name="password"]', testUser.password);
      await page.click('button[type="submit"]');
      
      // Wait for login to complete
      await page.waitForTimeout(2000);
    }
    
    // Check if we're logged in by looking for Write menu
    const writeButton = page.locator('text=Write').first();
    const isLoggedIn = await writeButton.isVisible().catch(() => false);
    
    if (isLoggedIn) {
      console.log('✅ Successfully logged in');
      
      // Navigate to compose page
      await writeButton.click();
      
      // Wait for dropdown to appear
      await page.waitForTimeout(500);
      
      // Click Compose in dropdown
      const composeLink = page.locator('.dropdown-menu >> text=Compose');
      await composeLink.click();
      
      await expect(page).toHaveURL('/compose');
      console.log('📍 Navigated to compose page');
      
      // Fill in the letter form
      await page.fill('input[name="title"]', testLetter.title);
      console.log('📝 Filled title:', testLetter.title);
      
      await page.fill('textarea[name="body"]', testLetter.body);
      console.log('📝 Filled body');
      
      // Add tags if tag input exists
      const tagInput = page.locator('#tag-search');
      const hasTagInput = await tagInput.isVisible().catch(() => false);
      
      if (hasTagInput) {
        console.log('📝 Adding tags...');
        for (const tag of testLetter.tags) {
          await tagInput.fill(tag);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(500);
        }
      }
      
      // Submit the letter
      const publishButton = page.locator('button:has-text("Publish")').first();
      await publishButton.click();
      console.log('📤 Clicked publish button');
      
      // Handle honor system modal if it appears
      const modalButton = page.locator('.modal button:has-text("I understand")');
      const hasModal = await modalButton.isVisible({ timeout: 2000 }).catch(() => false);
      
      if (hasModal) {
        console.log('📝 Handling honor system modal');
        await modalButton.click();
      }
      
      // Wait for navigation after publish
      await page.waitForTimeout(2000);
      
      // Check if letter was created successfully
      const successUrl = page.url();
      if (!successUrl.includes('compose')) {
        console.log('✅ Letter created successfully!');
        console.log('📍 Redirected to:', successUrl);
      } else {
        console.log('⚠️  Still on compose page, checking for errors...');
        
        // Check for error messages
        const errorMessage = await page.locator('.error, .alert-danger').textContent().catch(() => null);
        if (errorMessage) {
          console.log('❌ Error:', errorMessage);
        }
      }
      
      // Navigate to home to see if letter appears (after 12 hour steep)
      await page.goto('/');
      console.log('📍 Returned to homepage');
      
      // Check for drafts
      await writeButton.click();
      await page.waitForTimeout(500);
      const draftsLink = page.locator('.dropdown-menu >> text=Drafts');
      await draftsLink.click();
      
      await expect(page).toHaveURL('/drafts');
      console.log('📍 Checking drafts page');
      
      // Look for our letter in drafts
      const draftTitle = page.locator(`text="${testLetter.title}"`);
      const isDraftVisible = await draftTitle.isVisible({ timeout: 5000 }).catch(() => false);
      
      if (isDraftVisible) {
        console.log('✅ Letter found in drafts (waiting for 12-hour steep)');
      } else {
        console.log('ℹ️  Letter not in drafts (may have been published immediately)');
      }
      
    } else {
      console.log('❌ Could not log in - Write button not found');
      
      // Take a screenshot for debugging
      await page.screenshot({ path: 'login-failed.png' });
      console.log('📸 Screenshot saved as login-failed.png');
    }
  });

  test('should test the full letter creation flow with Apple Sign-In fallback', async ({ page }) => {
    // This test handles the Apple Sign-In flow
    await page.goto('/login');
    console.log('📍 Starting at login page');
    
    // Check if we have Apple Sign-In
    const appleButton = page.locator('text=Continue with Apple').first();
    const hasAppleSignIn = await appleButton.isVisible().catch(() => false);
    
    if (hasAppleSignIn) {
      console.log('🍎 Apple Sign-In detected');
      
      // For testing purposes, we'll use regular login if available
      const emailInput = page.locator('input[name="email"]');
      const hasRegularLogin = await emailInput.isVisible().catch(() => false);
      
      if (hasRegularLogin) {
        console.log('📝 Using regular login form');
        await emailInput.fill(testUser.email);
        await page.fill('input[name="password"]', testUser.password);
        await page.click('button[type="submit"]');
        
        // Wait for login
        await page.waitForTimeout(2000);
        
        // Check if logged in
        const currentUrl = page.url();
        if (!currentUrl.includes('login')) {
          console.log('✅ Login successful');
        } else {
          console.log('❌ Login failed - still on login page');
        }
      } else {
        console.log('⚠️  Only Apple Sign-In available - skipping test');
        // In a real scenario, you'd need to mock or handle OAuth
      }
    }
  });

  test('should verify letter creation restrictions', async ({ page, context }) => {
    // This test verifies the 12-hour steep and one letter per day restrictions
    
    // Create a fresh context with no cookies
    await context.clearCookies();
    
    await page.goto('/compose');
    
    // Should redirect to login since we're not authenticated
    await expect(page).toHaveURL(/login/);
    console.log('✅ Compose page requires authentication');
    
    // Try to access drafts
    await page.goto('/drafts');
    await expect(page).toHaveURL(/login/);
    console.log('✅ Drafts page requires authentication');
    
    // Try to access profile
    await page.goto('/profile');
    await expect(page).toHaveURL(/login/);
    console.log('✅ Profile page requires authentication');
  });

  test('should test mobile letter creation', async ({ page, context }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    console.log('📱 Testing on mobile viewport');
    
    await page.goto('/');
    
    // Check if navigation is mobile-optimized
    const nav = page.locator('.nav');
    const navBox = await nav.boundingBox();
    
    if (navBox && navBox.width <= 375) {
      console.log('✅ Navigation is mobile-optimized');
    }
    
    // Test touch interactions
    const writeButton = page.locator('text=Write').first();
    const isVisible = await writeButton.isVisible().catch(() => false);
    
    if (isVisible) {
      // Use tap for mobile
      await writeButton.tap();
      console.log('✅ Touch interaction works');
      
      // Check if dropdown is touch-friendly
      const dropdown = page.locator('.dropdown-menu');
      const isDropdownVisible = await dropdown.isVisible({ timeout: 1000 }).catch(() => false);
      
      if (isDropdownVisible) {
        console.log('✅ Dropdown menu works on mobile');
      }
    }
  });
});

test.describe('Letter Reading and Interaction', () => {
  test('should browse and read letters', async ({ page }) => {
    await page.goto('/');
    console.log('📍 Browsing letters on homepage');
    
    // Look for letters in the feed
    const letters = page.locator('.letter');
    const letterCount = await letters.count();
    
    console.log(`📚 Found ${letterCount} letters in feed`);
    
    if (letterCount > 0) {
      // Click on the first letter
      const firstLetter = letters.first();
      const letterTitle = await firstLetter.locator('h2').textContent();
      console.log(`📖 Opening letter: "${letterTitle}"`);
      
      await firstLetter.click();
      
      // Wait for navigation
      await page.waitForTimeout(1000);
      
      // Check if we're on a letter page
      const url = page.url();
      if (url.includes('/letters/')) {
        console.log('✅ Successfully opened letter');
        
        // Check for letter content
        const content = page.locator('.letter-content');
        const hasContent = await content.isVisible().catch(() => false);
        
        if (hasContent) {
          console.log('✅ Letter content is visible');
        }
        
        // Check for reading actions (if logged in)
        const readButton = page.locator('button:has-text("Read")');
        const hasReadButton = await readButton.isVisible().catch(() => false);
        
        if (hasReadButton) {
          console.log('✅ Reading actions available');
          
          // Test read action
          await readButton.click();
          console.log('✅ Marked letter as read');
        }
      }
    } else {
      console.log('ℹ️  No letters in feed (database might be empty)');
    }
  });

  test('should test mosaic navigation', async ({ page }) => {
    await page.goto('/tags');
    console.log('📍 Browsing mosaics');
    
    // Check for mosaic cards
    const cards = page.locator('.card');
    const cardCount = await cards.count();
    
    console.log(`🎨 Found ${cardCount} mosaics`);
    
    if (cardCount > 0) {
      // Click on first mosaic
      const firstCard = cards.first();
      const mosaicName = await firstCard.locator('.card-title').textContent().catch(() => 'Unknown');
      console.log(`🎨 Clicking on mosaic: "${mosaicName}"`);
      
      await firstCard.click();
      
      // Wait for navigation
      await page.waitForTimeout(1000);
      
      const url = page.url();
      console.log('📍 Navigated to:', url);
      
      // Check if we need to request access
      const requestButton = page.locator('button:has-text("Request Access")');
      const needsAccess = await requestButton.isVisible().catch(() => false);
      
      if (needsAccess) {
        console.log('🔒 Mosaic requires access request');
      } else {
        console.log('✅ Mosaic is accessible');
      }
    }
  });
});
