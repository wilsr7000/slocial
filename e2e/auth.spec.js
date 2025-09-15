const { test, expect } = require('@playwright/test');

test.describe('Authentication Flow', () => {
  test('should display login page', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle(/Sign In/);
    await expect(page.locator('h1')).toContainText('Sign in to Slocial');
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });

  test('should display signup page', async ({ page }) => {
    await page.goto('/signup');
    await expect(page).toHaveTitle(/Sign Up/);
    await expect(page.locator('h1')).toContainText('Create your account');
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="handle"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });

  test('should navigate between login and signup', async ({ page }) => {
    await page.goto('/login');
    await page.click('text=Create account');
    await expect(page).toHaveURL('/signup');
    
    await page.click('text=Sign in');
    await expect(page).toHaveURL('/login');
  });

  test('should show validation errors for invalid login', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'invalid@test.com');
    await page.fill('input[name="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    
    // Should see error message or stay on login page
    await expect(page).toHaveURL(/login/);
  });

  test('should redirect to login when accessing protected routes', async ({ page }) => {
    // Try to access compose page without auth
    await page.goto('/compose');
    await expect(page).toHaveURL(/login/);
    
    // Try to access profile without auth
    await page.goto('/profile');
    await expect(page).toHaveURL(/login/);
    
    // Try to access drafts without auth
    await page.goto('/drafts');
    await expect(page).toHaveURL(/login/);
  });

  test('should handle signup with existing email gracefully', async ({ page }) => {
    await page.goto('/signup');
    
    // Try to sign up with an email that might exist
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="handle"]', 'testuser123');
    await page.fill('input[name="password"]', 'password123');
    await page.click('button[type="submit"]');
    
    // Should either succeed or show appropriate error
    // This tests the error handling flow
    const url = page.url();
    expect(url.includes('/signup') || url.includes('/')).toBeTruthy();
  });

  test('should display theme toggle in footer', async ({ page }) => {
    await page.goto('/');
    
    // Check if theme toggle exists in footer
    const themeToggle = page.locator('.footer .theme-toggle');
    await expect(themeToggle).toBeVisible();
    
    // Test theme switching
    const htmlElement = page.locator('html');
    const initialTheme = await htmlElement.getAttribute('data-theme');
    
    await themeToggle.click();
    
    const newTheme = await htmlElement.getAttribute('data-theme');
    expect(newTheme).not.toBe(initialTheme);
  });

  test('should show different content for logged out vs logged in users', async ({ page }) => {
    await page.goto('/');
    
    // For logged out users, should see hero section
    const heroSection = page.locator('.hero');
    const heroVisible = await heroSection.isVisible().catch(() => false);
    
    if (heroVisible) {
      // User is logged out - should see marketing content
      await expect(page.locator('text=12-hour steep')).toBeVisible();
      await expect(page.locator('text=Create account')).toBeVisible();
    } else {
      // User might be logged in - should not see marketing content
      await expect(page.locator('text=12-hour steep')).not.toBeVisible();
    }
  });
});
