import { test, expect } from '@playwright/test';

test.describe('Home page', () => {
  test('renders landing without crash', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(500);
  });

  test('shows Acceder link', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Acceder' })).toBeVisible();
  });
});

test.describe('Login page', () => {
  test('renders login form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Bienvenido de vuelta' })).toBeVisible();
  });

  test('shows email and password fields', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Contraseña')).toBeVisible();
  });

  test('shows validation errors on empty submit', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByText(/inválido|mínimo/i).first()).toBeVisible();
  });
});

test.describe('Dashboard auth guard', () => {
  test('redirects /dashboard to /login when unauthenticated', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('redirects /dashboard/cameras to /login when unauthenticated', async ({ page }) => {
    await page.goto('/dashboard/cameras');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Health check', () => {
  test('/api/health returns ok', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
