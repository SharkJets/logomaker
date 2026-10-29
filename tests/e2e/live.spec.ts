import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.skip(!process.env.THEN_KEY, 'THEN_KEY not set');

test('test_live_search_api', async ({ request }) => {
  const r = await request.get('/api/search?q=star');
  expect(r.status(), await r.text()).toBe(200);
  const body = await r.json();
  expect(body.icons.length).toBeGreaterThan(0);
});

test('test_live_flow', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Search icons').fill('star');
  await page.getByLabel('Search icons').press('Enter');
  await page.locator('aside button img').first().click();
  await expect(page.getByTestId('count')).toHaveText('1');
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export SVG' }).click();
  const d = await dl;
  expect(await readFile((await d.path())!, 'utf8')).toContain('<svg');
});
