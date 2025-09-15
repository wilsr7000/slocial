const { test, expect } = require('@playwright/test');

test.describe('Theme Switching', () => {
  test('should toggle between light and dark themes', async ({ page }) => {
    await page.goto('/');
    
    // Get initial theme
    const initialTheme = await page.evaluate(() => 
      document.documentElement.getAttribute('data-theme')
    );
    
    // Find and click theme toggle
    const themeToggle = page.locator('.footer .theme-toggle');
    await expect(themeToggle).toBeVisible();
    await themeToggle.click();
    
    // Theme should change
    const newTheme = await page.evaluate(() => 
      document.documentElement.getAttribute('data-theme')
    );
    expect(newTheme).not.toBe(initialTheme);
    
    // Toggle back
    await themeToggle.click();
    const finalTheme = await page.evaluate(() => 
      document.documentElement.getAttribute('data-theme')
    );
    expect(finalTheme).toBe(initialTheme);
  });

  test('should persist theme preference in cookie', async ({ page, context }) => {
    await page.goto('/');
    
    // Set to dark theme
    const themeToggle = page.locator('.footer .theme-toggle');
    await themeToggle.click();
    
    const theme = await page.evaluate(() => 
      document.documentElement.getAttribute('data-theme')
    );
    
    // Get cookies
    const cookies = await context.cookies();
    const themeCookie = cookies.find(c => c.name === 'theme');
    
    expect(themeCookie).toBeTruthy();
    expect(themeCookie.value).toBe(theme);
    
    // Navigate to another page - theme should persist
    await page.goto('/about');
    const aboutTheme = await page.evaluate(() => 
      document.documentElement.getAttribute('data-theme')
    );
    expect(aboutTheme).toBe(theme);
  });

  test('should update theme toggle icon', async ({ page }) => {
    await page.goto('/');
    
    const themeToggle = page.locator('.footer .theme-toggle');
    const initialIcon = await themeToggle.textContent();
    
    await themeToggle.click();
    
    const newIcon = await themeToggle.textContent();
    expect(newIcon).not.toBe(initialIcon);
    
    // Icons should be moon or sun
    expect(['🌙', '☀️']).toContain(newIcon.trim());
  });

  test('should apply correct styles in dark mode', async ({ page }) => {
    await page.goto('/');
    
    // Set to dark theme
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    
    // Check background color
    const bgColor = await page.evaluate(() => {
      return window.getComputedStyle(document.body).backgroundColor;
    });
    
    // Dark mode should have dark background
    // RGB values should be low for dark colors
    const rgb = bgColor.match(/\d+/g);
    if (rgb) {
      const [r, g, b] = rgb.map(Number);
      expect(r).toBeLessThan(50);
      expect(g).toBeLessThan(50);
      expect(b).toBeLessThan(50);
    }
  });

  test('should apply correct styles in light mode', async ({ page }) => {
    await page.goto('/');
    
    // Set to light theme
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });
    
    // Check background color
    const bgColor = await page.evaluate(() => {
      return window.getComputedStyle(document.body).backgroundColor;
    });
    
    // Light mode should have light background
    // RGB values should be high for light colors
    const rgb = bgColor.match(/\d+/g);
    if (rgb) {
      const [r, g, b] = rgb.map(Number);
      expect(r).toBeGreaterThan(200);
      expect(g).toBeGreaterThan(200);
      expect(b).toBeGreaterThan(200);
    }
  });

  test('should handle theme on login/signup pages', async ({ page }) => {
    // Test login page
    await page.goto('/login');
    
    // Should have theme-aware logo
    const logoLight = page.locator('.logo-light');
    const logoDark = page.locator('.logo-dark');
    
    await expect(logoLight).toHaveCount(1);
    await expect(logoDark).toHaveCount(1);
    
    // Set to light theme
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });
    
    // Light logo should be visible
    await expect(logoLight).toBeVisible();
    await expect(logoDark).toBeHidden();
    
    // Set to dark theme
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    
    // Dark logo should be visible
    await expect(logoDark).toBeVisible();
    await expect(logoLight).toBeHidden();
    
    // Test signup page
    await page.goto('/signup');
    
    const signupLogoLight = page.locator('.logo-light');
    const signupLogoDark = page.locator('.logo-dark');
    
    await expect(signupLogoLight).toHaveCount(1);
    await expect(signupLogoDark).toHaveCount(1);
  });

  test('should handle theme in modals', async ({ page }) => {
    await page.goto('/tags');
    
    // Set to dark theme
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    
    // If create button is visible, test modal theme
    const createButton = page.locator('button:has-text("Create Mosaic")');
    const isVisible = await createButton.isVisible().catch(() => false);
    
    if (isVisible) {
      await createButton.click();
      
      const modal = page.locator('.modal-content');
      await expect(modal).toBeVisible();
      
      // Modal should have dark theme styles
      const modalBg = await modal.evaluate(el => 
        window.getComputedStyle(el).backgroundColor
      );
      
      // Should have dark background
      const rgb = modalBg.match(/\d+/g);
      if (rgb) {
        const [r, g, b] = rgb.map(Number);
        expect(r).toBeLessThan(100);
      }
      
      // Close modal
      await page.click('.modal-header .close-button');
    }
  });

  test('should have no color contrast issues', async ({ page }) => {
    await page.goto('/');
    
    // Test in both themes
    for (const theme of ['light', 'dark']) {
      await page.evaluate((t) => {
        document.documentElement.setAttribute('data-theme', t);
      }, theme);
      
      // Check that text is visible against background
      const textColor = await page.evaluate(() => {
        return window.getComputedStyle(document.body).color;
      });
      
      const bgColor = await page.evaluate(() => {
        return window.getComputedStyle(document.body).backgroundColor;
      });
      
      // Text and background should be different
      expect(textColor).not.toBe(bgColor);
    }
  });
});
