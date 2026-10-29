import { test, expect, type Page } from '@playwright/test';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></svg>';
// 1x1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const THUMB = 'data:image/png;base64,' + PNG.toString('base64');

async function setup(page: Page, opts: { attribution?: string; next?: string | null; png?: boolean } = {}) {
  const urls: string[] = [];
  await page.route('**/api/search*', (r) => {
    urls.push(r.request().url());
    r.fulfill({ json: { icons: [{ id: opts.png ? '2' : '1', thumb: THUMB, attribution: opts.attribution ?? 'Cat by Ann' }], next: opts.next ?? null } });
  });
  await page.route('**/api/icon/*', (r) =>
    opts.png ? r.fulfill({ contentType: 'image/png', body: PNG }) : r.fulfill({ contentType: 'image/svg+xml', body: SVG }));
  await page.goto('/');
  await page.waitForLoadState('networkidle'); // let the island hydrate
  await page.getByLabel('Search icons').fill('cat');
  await page.getByLabel('Search icons').press('Enter');
  await expect(page.getByRole('button', { name: opts.attribution ?? 'Cat by Ann' })).toHaveCount(1);
  return urls;
}
const count = (p: Page) => p.getByTestId('count');
const addIcon = async (p: Page) => { await p.locator('aside button img').first().click(); await expect(count(p)).toHaveText('1'); };

test('test_search_shows_results', async ({ page }) => {
  await setup(page);
  await expect(page.locator('aside img')).toHaveCount(1);
});

test('test_click_adds', async ({ page }) => {
  await setup(page);
  await addIcon(page);
});

test('test_color', async ({ page }) => {
  await setup(page);
  await addIcon(page);
  await page.getByLabel('Color').fill('#ff0000');
  await expect(count(page)).toHaveText('1');
});

test('test_undo_button', async ({ page }) => {
  await setup(page);
  await addIcon(page);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(count(page)).toHaveText('0');
});

test('test_text_button', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Add text' }).click();
  await expect(count(page)).toHaveText('1');
});

test('test_export_svg', async ({ page }) => {
  await setup(page);
  await addIcon(page);
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export SVG' }).click();
  const d = await dl;
  expect(d.suggestedFilename()).toBe('logo.svg');
  expect(await (await import('node:fs/promises')).readFile((await d.path())!, 'utf8')).toContain('<svg');
});

test('test_export_png', async ({ page }) => {
  await setup(page);
  await addIcon(page);
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG' }).click();
  const d = await dl;
  expect(d.suggestedFilename()).toBe('logo.png');
  expect((await (await import('node:fs/promises')).stat((await d.path())!)).size).toBeGreaterThan(0);
});

test('test_load_more', async ({ page }) => {
  const urls = await setup(page, { next: 'abc' });
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect.poll(() => urls.some((u) => u.endsWith('/api/search?q=cat&next=abc'))).toBe(true);
});

test('test_attribution_escaped', async ({ page }) => {
  const evil = '<img src=x onerror=alert(1)>';
  let dialog = false;
  page.on('dialog', (d) => { dialog = true; d.dismiss(); });
  await setup(page, { attribution: evil });
  await expect(page.locator('aside button img')).toHaveAttribute('alt', evil);
  await expect(page.locator('aside button img')).toHaveCount(1);
  expect(dialog).toBe(false);
});

test('test_png_fallback_icon', async ({ page }) => {
  await setup(page, { png: true });
  await addIcon(page);
});
