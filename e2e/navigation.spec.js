const { test, expect } = require('@playwright/test');

test.describe('Navigation and Public Pages', () => {
  test('should load homepage', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Slocial/);
    
    // Check main navigation items
    await expect(page.locator('nav >> text=Read')).toBeVisible();
    await expect(page.locator('nav >> text=Mosaics')).toBeVisible();
    await expect(page.locator('nav >> text=Write')).toBeVisible();
  });

  test('should navigate to Mosaics page', async ({ page }) => {
    await page.goto('/');
    await page.click('nav >> text=Mosaics');
    await expect(page).toHaveURL('/tags');
    await expect(page.locator('h1')).toContainText('Explore Mosaics');
  });

  test('should navigate to About page', async ({ page }) => {
    await page.goto('/');
    await page.click('footer >> text=About this project');
    await expect(page).toHaveURL('/about');
    await expect(page).toHaveTitle(/About this project/);
    await expect(page.locator('h1')).toContainText('About This Project');
    
    // Check for McLuhan concepts
    await expect(page.locator('text=Marshall McLuhan')).toBeVisible();
    await expect(page.locator('text=mosaic')).toBeVisible();
  });

  test('should navigate to Principles page', async ({ page }) => {
    await page.goto('/');
    await page.click('footer >> text=Principles');
    await expect(page).toHaveURL('/principles');
    await expect(page.locator('h1')).toContainText('Slocial Principles');
  });

  test('should handle Write dropdown menu', async ({ page }) => {
    await page.goto('/');
    const writeButton = page.locator('nav >> text=Write');
    
    // Initially dropdown should be hidden
    const dropdown = page.locator('.dropdown-menu');
    await expect(dropdown).toBeHidden();
    
    // Click Write to show dropdown
    await writeButton.click();
    await expect(dropdown).toBeVisible();
    
    // Check dropdown items
    await expect(page.locator('.dropdown-menu >> text=Compose')).toBeVisible();
    await expect(page.locator('.dropdown-menu >> text=Drafts')).toBeVisible();
    await expect(page.locator('.dropdown-menu >> text=Profile')).toBeVisible();
    
    // Clicking outside should close dropdown
    await page.click('body');
    await expect(dropdown).toBeHidden();
  });

  test('should display footer links', async ({ page }) => {
    await page.goto('/');
    
    const footer = page.locator('.footer');
    await expect(footer).toBeVisible();
    
    // Check footer navigation items
    await expect(footer.locator('text=About this project')).toBeVisible();
    await expect(footer.locator('text=Principles')).toBeVisible();
    await expect(footer.locator('.theme-toggle')).toBeVisible();
  });

  test('should handle 404 pages gracefully', async ({ page }) => {
    const response = await page.goto('/nonexistent-page-12345');
    
    // Should either show 404 or redirect to home
    expect(response.status()).toBeLessThanOrEqual(404);
  });

  test('should have responsive meta tags', async ({ page }) => {
    await page.goto('/');
    
    // Check viewport meta tag
    const viewport = await page.$eval('meta[name="viewport"]', el => el.content);
    expect(viewport).toContain('width=device-width');
    expect(viewport).toContain('initial-scale=1');
    
    // Check mobile CSS is loaded
    const mobileCSS = await page.$('link[href*="mobile.css"]');
    expect(mobileCSS).toBeTruthy();
  });

  test('should load static assets', async ({ page }) => {
    await page.goto('/');
    
    // Check CSS loads
    const cssResponse = await page.request.get('/static/css/styles.css');
    expect(cssResponse.status()).toBe(200);
    
    // Check mobile CSS loads
    const mobileCSSResponse = await page.request.get('/static/css/mobile.css');
    expect(mobileCSSResponse.status()).toBe(200);
  });
});
