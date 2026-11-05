import { test, expect } from '@playwright/test';

const TEST_EMAIL = 'test@pradomotica.local';
const TEST_PASSWORD = 'Test1234!';

test.describe('Auth: login con credenciales de prueba', () => {
  test('login exitoso redirige al dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(TEST_EMAIL);
    await page.getByLabel('Contraseña').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
    await expect(page.getByText('Tu hogar')).toBeVisible();
  });

  test('credenciales incorrectas muestran error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(TEST_EMAIL);
    await page.getByLabel('Contraseña').fill('wrong-password');
    await page.getByRole('button', { name: 'Entrar' }).click();

    await expect(page.getByText(/credenciales inválidas/i)).toBeVisible({ timeout: 8_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test('dashboard muestra cámaras cuando estás autenticado', async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.getByLabel('Email').fill(TEST_EMAIL);
    await page.getByLabel('Contraseña').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });

    // Navegar a cámaras
    await page.getByRole('link', { name: 'Cámaras', exact: true }).first().click();
    await expect(page).toHaveURL(/\/dashboard\/cameras/);
    // La página muestra el título "Cámaras" tanto si hay dispositivos como si no
    await expect(page.getByRole('heading', { name: 'Cámaras' })).toBeVisible();
  });

  test('cerrar sesión redirige al login', async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.getByLabel('Email').fill(TEST_EMAIL);
    await page.getByLabel('Contraseña').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });

    // Logout
    await page.getByRole('button', { name: /cerrar sesión/i }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 8_000 });
  });
});

test.describe('Onboarding', () => {
  test('redirige al login porque ya hay un usuario', async ({ page }) => {
    await page.goto('/onboarding');
    // Debe redirigir a /login porque el usuario de prueba ya existe
    await expect(page).toHaveURL(/\/login/, { timeout: 8_000 });
  });
});
