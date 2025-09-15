# End-to-End Testing with Playwright

This directory contains end-to-end (E2E) tests for Slocial using Playwright.

## What is Playwright?

Playwright is a modern web testing framework that allows you to:
- Test across multiple browsers (Chrome, Firefox, Safari)
- Test on mobile viewports
- Take screenshots and videos of failures
- Run tests in parallel for speed
- Debug tests interactively

## Test Coverage

Our E2E tests cover:

### 1. Authentication (`auth.spec.js`)
- Login/signup pages
- Form validation
- Protected route redirects
- Theme persistence
- User session management

### 2. Navigation (`navigation.spec.js`)
- Homepage loading
- Main navigation menu
- Write dropdown functionality
- Footer links
- Static asset loading
- 404 handling

### 3. Mosaics/Tags (`mosaics.spec.js`)
- Mosaic exploration page
- Create mosaic modal
- Card display and styling
- Image loading/fallbacks
- Access requests
- Auto-approve badges

### 4. Mobile Responsiveness (`mobile.spec.js`)
- Touch-friendly navigation
- Mobile viewport handling
- Responsive layouts
- Touch targets
- Mobile-optimized modals

### 5. Theme Switching (`theme.spec.js`)
- Light/dark mode toggle
- Theme persistence
- Logo switching on auth pages
- Modal theming
- Color contrast

## Running Tests

### Basic Commands

```bash
# Run all E2E tests
npm run e2e

# Run tests with UI mode (interactive)
npm run e2e:ui

# Run tests in headed mode (see browser)
npm run e2e:headed

# Debug tests step-by-step
npm run e2e:debug

# Run only Chrome tests
npm run e2e:chrome

# Run only mobile tests
npm run e2e:mobile

# Run tests against production
npm run e2e:production

# View test report after running
npm run e2e:report
```

### Running Specific Tests

```bash
# Run a specific test file
npx playwright test e2e/auth.spec.js

# Run tests matching a pattern
npx playwright test -g "login"

# Run a specific browser
npx playwright test --project=firefox
```

## Test Development

### Writing New Tests

1. Create a new file in the `e2e/` directory
2. Import Playwright test utilities:
   ```javascript
   const { test, expect } = require('@playwright/test');
   ```
3. Group related tests:
   ```javascript
   test.describe('Feature Name', () => {
     test('should do something', async ({ page }) => {
       await page.goto('/');
       await expect(page).toHaveTitle(/Slocial/);
     });
   });
   ```

### Best Practices

1. **Use descriptive test names**: Start with "should" to describe expected behavior
2. **Group related tests**: Use `test.describe()` blocks
3. **Wait for elements**: Use `await expect()` for assertions
4. **Handle async operations**: Always use `async/await`
5. **Test user flows**: Think like a user, not a developer
6. **Check for accessibility**: Include tests for keyboard navigation and screen readers

### Debugging Failed Tests

1. **Run in headed mode**: See what's happening
   ```bash
   npm run e2e:headed
   ```

2. **Use debug mode**: Step through tests
   ```bash
   npm run e2e:debug
   ```

3. **Check screenshots**: Failed tests save screenshots in `test-results/`

4. **View traces**: Playwright records traces for failed tests
   ```bash
   npx playwright show-trace test-results/[test-name]/trace.zip
   ```

## CI/CD Integration

To run tests in CI:

```yaml
# Example GitHub Actions
- name: Install dependencies
  run: npm ci
  
- name: Install Playwright browsers
  run: npx playwright install --with-deps
  
- name: Run E2E tests
  run: npm run e2e
  
- name: Upload test results
  if: always()
  uses: actions/upload-artifact@v3
  with:
    name: playwright-report
    path: playwright-report/
```

## Configuration

Test configuration is in `playwright.config.js`:

- **Base URL**: Set via `E2E_BASE_URL` env var or defaults to `http://localhost:3000`
- **Browsers**: Chrome, Firefox, Safari, Mobile Chrome, Mobile Safari
- **Parallel execution**: Tests run in parallel by default
- **Retries**: 2 retries on CI, 0 locally
- **Screenshots/Videos**: Captured on failure

## Troubleshooting

### Tests fail with "Connection refused"

Make sure the dev server is running:
```bash
npm run dev
```

Or let Playwright start it automatically (configured in `playwright.config.js`).

### Browser not installed

Install Playwright browsers:
```bash
npx playwright install
```

### Tests are slow

- Run specific tests instead of all
- Use `--project=chromium` to test one browser
- Increase workers: `npx playwright test --workers=4`

### Different results locally vs CI

- Check for timing issues (add explicit waits if needed)
- Ensure same browser versions
- Check for environment-specific data

## Tips

1. **Generate tests**: Use Playwright codegen to record actions
   ```bash
   npx playwright codegen http://localhost:3000
   ```

2. **Take screenshots**: For visual debugging
   ```javascript
   await page.screenshot({ path: 'debug.png' });
   ```

3. **Test multiple viewports**: 
   ```javascript
   await page.setViewportSize({ width: 375, height: 667 });
   ```

4. **Mock API responses**: For testing edge cases
   ```javascript
   await page.route('/api/endpoint', route => {
     route.fulfill({ json: { data: 'mocked' } });
   });
   ```
