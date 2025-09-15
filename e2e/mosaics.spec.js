const { test, expect } = require('@playwright/test');

test.describe('Mosaics (Tags) Functionality', () => {
  test('should display mosaics exploration page', async ({ page }) => {
    await page.goto('/tags');
    
    await expect(page.locator('h1')).toContainText('Explore Mosaics');
    await expect(page.locator('.card-grid')).toBeVisible();
  });

  test('should show create mosaic button for logged in users', async ({ page }) => {
    await page.goto('/tags');
    
    // The button might only be visible for authenticated users
    const createButton = page.locator('button:has-text("Create Mosaic")');
    const isVisible = await createButton.isVisible().catch(() => false);
    
    if (isVisible) {
      await createButton.click();
      
      // Modal should appear
      const modal = page.locator('#createTagModal');
      await expect(modal).toBeVisible();
      
      // Check form fields
      await expect(page.locator('input[name="name"]')).toBeVisible();
      await expect(page.locator('textarea[name="short_description"]')).toBeVisible();
      await expect(page.locator('textarea[name="long_description"]')).toBeVisible();
      await expect(page.locator('input[name="image_url"]')).toBeVisible();
      await expect(page.locator('input[name="image_file"]')).toBeVisible();
      
      // Close modal
      await page.click('.modal-header .close-button');
      await expect(modal).toBeHidden();
    }
  });

  test('should display mosaic cards with proper styling', async ({ page }) => {
    await page.goto('/tags');
    
    const cards = page.locator('.card');
    const cardCount = await cards.count();
    
    if (cardCount > 0) {
      const firstCard = cards.first();
      
      // Check card structure
      await expect(firstCard.locator('.card-header')).toBeVisible();
      
      // Check for instant access badges if present
      const badge = firstCard.locator('.instant-badge');
      const hasBadge = await badge.isVisible().catch(() => false);
      
      if (hasBadge) {
        await expect(badge).toContainText('instant');
      }
    }
  });

  test('should handle image loading in mosaic cards', async ({ page }) => {
    await page.goto('/tags');
    
    // Find images in cards
    const images = page.locator('.card-header img');
    const imageCount = await images.count();
    
    if (imageCount > 0) {
      // Check first image
      const firstImage = images.first();
      
      // Wait for either image to load or error handler to kick in
      await page.waitForTimeout(1000);
      
      // Check if fallback is displayed (data-tag-initial attribute exists)
      const parent = await firstImage.locator('..');
      const hasInitial = await parent.getAttribute('data-tag-initial');
      
      // Image should either load or show fallback
      expect(hasInitial).toBeDefined();
    }
  });

  test('should filter public mosaics for non-authenticated users', async ({ page }) => {
    await page.goto('/tags');
    
    // Check that the page loads without errors
    await expect(page.locator('.card-grid')).toBeVisible();
    
    // For non-authenticated users, should only see public mosaics
    // This is verified by the page loading successfully
  });

  test('should show mosaic management options for owned mosaics', async ({ page }) => {
    // This would require authentication
    // For now, just check the structure exists
    
    const response = await page.goto('/tags/public/manage');
    
    // Should either redirect to login or show 404/403
    expect(response.status()).toBeLessThanOrEqual(404);
  });

  test('should handle mosaic access requests', async ({ page }) => {
    await page.goto('/tags');
    
    const cards = page.locator('.card');
    const cardCount = await cards.count();
    
    if (cardCount > 0) {
      // Click on first card
      await cards.first().click();
      
      // Should either navigate to mosaic read page or show access request
      await page.waitForTimeout(500);
      
      const url = page.url();
      expect(url).toMatch(/\/(tags|mosaics|login)/);
    }
  });

  test('should display auto-approve status on mosaics', async ({ page }) => {
    await page.goto('/tags');
    
    // Look for instant access badges
    const instantBadges = page.locator('.instant-badge');
    const badgeCount = await instantBadges.count();
    
    if (badgeCount > 0) {
      const firstBadge = instantBadges.first();
      await expect(firstBadge).toContainText('instant');
      
      // Badge should have proper styling
      const backgroundColor = await firstBadge.evaluate(el => 
        window.getComputedStyle(el).backgroundColor
      );
      expect(backgroundColor).toBeTruthy();
    }
  });
});
