const { test, expect, devices } = require('@playwright/test');

// Test specifically for mobile devices
test.use(devices['iPhone 12']);

test.describe('Mobile Responsiveness', () => {
  test('should display mobile-optimized navigation', async ({ page }) => {
    await page.goto('/');
    
    // Navigation should be visible on mobile
    const nav = page.locator('.nav');
    await expect(nav).toBeVisible();
    
    // Check if navigation is stacked for mobile
    const navRect = await nav.boundingBox();
    expect(navRect.width).toBeLessThanOrEqual(400);
  });

  test('should have touch-friendly buttons on mobile', async ({ page }) => {
    await page.goto('/');
    
    // Check button sizes
    const buttons = page.locator('button, .btn');
    const buttonCount = await buttons.count();
    
    if (buttonCount > 0) {
      const firstButton = buttons.first();
      const box = await firstButton.boundingBox();
      
      // Buttons should be at least 44px tall for touch targets
      expect(box.height).toBeGreaterThanOrEqual(40);
    }
  });

  test('should display readable text on mobile', async ({ page }) => {
    await page.goto('/');
    
    // Check that text is not too small
    const bodyFontSize = await page.evaluate(() => {
      return window.getComputedStyle(document.body).fontSize;
    });
    
    // Font size should be at least 14px
    const fontSize = parseInt(bodyFontSize);
    expect(fontSize).toBeGreaterThanOrEqual(14);
  });

  test('should handle mobile viewport correctly', async ({ page }) => {
    await page.goto('/');
    
    // Check viewport settings
    const viewportSize = page.viewportSize();
    expect(viewportSize.width).toBeLessThanOrEqual(414); // iPhone width
    
    // Content should not overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportSize.width + 20); // Allow small margin
  });

  test('should show mobile-optimized cards', async ({ page }) => {
    await page.goto('/tags');
    
    const cards = page.locator('.card');
    const cardCount = await cards.count();
    
    if (cardCount > 0) {
      const firstCard = cards.first();
      const box = await firstCard.boundingBox();
      
      // Cards should take most of mobile width
      const viewportSize = page.viewportSize();
      expect(box.width).toBeGreaterThan(viewportSize.width * 0.8);
    }
  });

  test('should have mobile-friendly modals', async ({ page }) => {
    await page.goto('/login');
    
    // Login form should be mobile-optimized
    const form = page.locator('form');
    const formBox = await form.boundingBox();
    
    const viewportSize = page.viewportSize();
    expect(formBox.width).toBeLessThanOrEqual(viewportSize.width);
  });

  test('should handle mobile Write dropdown', async ({ page }) => {
    await page.goto('/');
    
    const writeButton = page.locator('nav >> text=Write');
    
    if (await writeButton.isVisible()) {
      await writeButton.tap(); // Use tap for mobile
      
      const dropdown = page.locator('.dropdown-menu');
      await expect(dropdown).toBeVisible();
      
      // Dropdown should be touch-friendly
      const dropdownBox = await dropdown.boundingBox();
      expect(dropdownBox).toBeTruthy();
      
      // Close by tapping outside
      await page.tap('body');
      await expect(dropdown).toBeHidden();
    }
  });

  test('should display mobile-optimized footer', async ({ page }) => {
    await page.goto('/');
    
    const footer = page.locator('.footer');
    await expect(footer).toBeVisible();
    
    // Footer should be stacked on mobile
    const footerBox = await footer.boundingBox();
    const viewportSize = page.viewportSize();
    
    expect(footerBox.width).toBeLessThanOrEqual(viewportSize.width);
  });

  test('should handle mobile theme toggle', async ({ page }) => {
    await page.goto('/');
    
    const themeToggle = page.locator('.footer .theme-toggle');
    await expect(themeToggle).toBeVisible();
    
    // Should be tappable
    const box = await themeToggle.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(40); // Touch-friendly size
    
    // Test toggling
    await themeToggle.tap();
    
    // Theme should change
    const theme = await page.evaluate(() => 
      document.documentElement.getAttribute('data-theme')
    );
    expect(theme).toMatch(/light|dark/);
  });

  test('should load mobile CSS', async ({ page }) => {
    await page.goto('/');
    
    // Verify mobile.css is loaded
    const mobileCSSLoaded = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
      return links.some(link => link.href.includes('mobile.css'));
    });
    
    expect(mobileCSSLoaded).toBeTruthy();
  });

  test('should prevent horizontal scroll on mobile', async ({ page }) => {
    await page.goto('/');
    
    // Check for horizontal overflow
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    
    expect(hasHorizontalScroll).toBeFalsy();
  });

  test('should have mobile-friendly images', async ({ page }) => {
    await page.goto('/login');
    
    const logo = page.locator('.logo-image').first();
    
    if (await logo.isVisible()) {
      const box = await logo.boundingBox();
      const viewportSize = page.viewportSize();
      
      // Logo should not be wider than viewport
      expect(box.width).toBeLessThanOrEqual(viewportSize.width * 0.9);
    }
  });
});
