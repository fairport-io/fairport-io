import { test, expect } from '@playwright/test';

test.describe('Login page', () => {
  test.use({ storageState: undefined });

  test('renders login form with email and password fields', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
    await expect(page.getByPlaceholder('Min. 8 characters')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create New Account' })).toBeVisible();
  });

  test('shows error on invalid login', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('you@example.com').fill('ghost@example.com');
    await page.getByPlaceholder('Min. 8 characters').fill('password123');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByText('Invalid credentials')).toBeVisible();
  });

  test('creates account and redirects to chat', async ({ page }) => {
    const email = `test-${Date.now()}@example.com`;
    await page.goto('/');
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByPlaceholder('Min. 8 characters').fill('password123');
    await page.getByRole('button', { name: 'Create New Account' }).click();
    await page.waitForURL(/\/chat$/, { timeout: 10000 });
    await expect(page.locator('select').first()).toHaveValue(`user:${email}`, { timeout: 10000 });
  });

  test('rejects signup with short password', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('you@example.com').fill('short@example.com');
    await page.getByPlaceholder('Min. 8 characters').fill('short');
    await page.getByRole('button', { name: 'Create New Account' }).click();
    await expect(page.getByText('Invalid data')).toBeVisible();
  });

  test('rejects duplicate signup', async ({ page }) => {
    const email = `dup-${Date.now()}@example.com`;
    await page.goto('/');
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByPlaceholder('Min. 8 characters').fill('password123');
    await page.getByRole('button', { name: 'Create New Account' }).click();
    await page.waitForURL(/\/chat$/, { timeout: 10000 });
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByPlaceholder('Min. 8 characters').fill('password123');
    await page.getByRole('button', { name: 'Create New Account' }).click();
    await expect(page.getByText('User exists')).toBeVisible();
  });

  test('logs in with existing account', async ({ page }) => {
    const email = `login-${Date.now()}@example.com`;
    await page.goto('/');
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByPlaceholder('Min. 8 characters').fill('password123');
    await page.getByRole('button', { name: 'Create New Account' }).click();
    await page.waitForURL(/\/chat$/, { timeout: 10000 });
    await page.getByRole('button', { name: 'Log out' }).click();
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByPlaceholder('Min. 8 characters').fill('password123');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForURL(/\/chat$/, { timeout: 10000 });
    await expect(page.locator('select').first()).toHaveValue(`user:${email}`, { timeout: 10000 });
  });

  test('logs out and clears session', async ({ page }) => {
    const email = `logout-${Date.now()}@example.com`;
    await page.goto('/');
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByPlaceholder('Min. 8 characters').fill('password123');
    await page.getByRole('button', { name: 'Create New Account' }).click();
    await page.waitForURL(/\/chat$/, { timeout: 10000 });
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
  });

  test.skip('pressing Enter triggers login', async ({ page }) => {
    const email = `enter-${Date.now()}@example.com`;
    await page.goto('/');
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByPlaceholder('Min. 8 characters').fill('password123');
    await page.getByPlaceholder('Min. 8 characters').press('Enter');
    await page.waitForURL(/\/chat$/, { timeout: 20000 });
  });
});
