import { test, expect } from '@playwright/test';

/**
 * Camera E2E tests — diagnostics for WebRTC streaming.
 *
 * Run with:
 *   PLAYWRIGHT_BASE_URL=https://app.example.com npx playwright test e2e/cameras.spec.ts
 *
 * These tests verify:
 * - go2rtc is reachable and healthy from the app
 * - Non-tablet camera WebRTC endpoint works
 * - Camera modal renders without error overlay
 */

const TEST_EMAIL = process.env.TEST_EMAIL ?? 'user@example.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'Test1234!';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(TEST_EMAIL);
  await page.getByLabel('Contraseña').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
}

test.describe('Camera infrastructure', () => {
  test('health endpoint is OK', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBeTruthy();
  });
});

test.describe('Camera live stream (non-tablet)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('cameras page loads and shows camera cards', async ({ page }) => {
    await page.goto('/dashboard/cameras');
    await page.waitForLoadState('networkidle');
    // Should show at least one camera (non-tablet)
    const cameraCards = page.locator('.grid > div.rounded-2xl');
    await expect(cameraCards.first()).toBeVisible({ timeout: 10000 });
    const count = await cameraCards.count();
    console.log(`Found ${count} camera card(s)`);
    expect(count).toBeGreaterThan(0);
  });

  test('clicking camera opens modal without go2rtc error', async ({ page }) => {
    await page.goto('/dashboard/cameras');
    await page.waitForLoadState('networkidle');

    // Click the first camera card (non-tablet won't have the "Test" badge)
    const firstCard = page.locator('.grid > div.rounded-2xl').first();
    await firstCard.locator('button').first().click();

    // Modal should appear
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Wait for streaming to attempt connection
    await page.waitForTimeout(6000);

    // Check NO go2rtc error
    const go2rtcError = modal.locator('text=servidor de streaming');
    const hasGo2rtcError = await go2rtcError.isVisible().catch(() => false);

    if (hasGo2rtcError) {
      console.error('ERROR: go2rtc is not reachable from the app container!');
      console.error('Run on the Pi: docker compose -f docker-compose.vps.yml logs go2rtc --tail=30');
      console.error('Also check: docker compose -f docker-compose.vps.yml exec app wget -q -O- http://go2rtc:1984/api');
    }
    expect(hasGo2rtcError).toBe(false);

    // Check no generic connection error
    const connError = modal.locator('text=Error');
    const hasConnError = await connError.isVisible().catch(() => false);
    if (hasConnError) {
      console.error('Stream connection error detected. Possible causes:');
      console.error('1. go2rtc cannot reach the camera at its stored IP (check docker network');
      console.error('   and that the IP still matches — DHCP leases change when the router does)');
      console.error('2. Camera RTSP stream is offline');
      console.error('3. ffmpeg transcoding failed');
    }
    expect(hasConnError).toBe(false);
  });

  test('snapshot proxy returns image', async ({ page, request }) => {
    await login(page);
    // Navigate to cameras to see the list
    await page.goto('/dashboard/cameras');
    await page.waitForLoadState('networkidle');

    // Get the camera ID from a snapshot image src
    const imgSrc = await page.locator('img[src*="/api/cameras/"]').first().getAttribute('src');
    expect(imgSrc).toBeTruthy();
    console.log(`Snapshot URL: ${imgSrc}`);

    // Directly fetch the snapshot
    const res = await request.get(imgSrc!);
    console.log(`Snapshot status: ${res.status()}`);
    if (res.status() === 502) {
      console.error('Camera snapshot proxy returned 502 — the camera might be offline or its IP changed');
    }
    expect(res.status()).toBeLessThan(500);
  });
});
