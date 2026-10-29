import { test, expect, type Page } from '@playwright/test';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></svg>';
// 1x1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const THUMB = 'data:image/png;base64,' + PNG.toString('base64');

async function setup(page: Page, opts: { attribution?: string; next?: string | null; png?: boolean } = {}) {
  const urls: string[] = [];
  await page.route('**/api/search*', (r) => {
    urls.push(r.request().url());
    r.fulfill({ json: { icons: [{ id: opts.png ? '2' : '1', thumb: THUMB, attribution: opts.attribution ?? 'Cat by Ann', svg: !opts.png }], next: opts.next ?? null } });
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

test('test_result_kind_badge', async ({ page }) => {
  await page.route('**/api/search*', (r) => r.fulfill({ json: { icons: [
    { id: '1', thumb: THUMB, attribution: 'A', svg: true },
    { id: '2', thumb: THUMB, attribution: 'B', svg: false },
  ], next: null } }));
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Search icons').fill('cat');
  await page.getByLabel('Search icons').press('Enter');
  await expect(page.getByTestId('kind')).toHaveText(['SVG', 'PNG']);
});

test('test_kind_filter', async ({ page }) => {
  await page.route('**/api/search*', (r) => r.fulfill({ json: { icons: [
    { id: '1', thumb: THUMB, attribution: 'A', svg: true },
    { id: '2', thumb: THUMB, attribution: 'B', svg: false },
  ], next: null } }));
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Search icons').fill('cat');
  await page.getByLabel('Search icons').press('Enter');
  const g = page.getByRole('radiogroup', { name: 'Show' });
  await expect(page.getByTestId('kind')).toHaveCount(2);
  await g.getByText('SVG', { exact: true }).click();
  await expect(page.getByTestId('kind')).toHaveText(['SVG']);
  await g.getByText('PNG', { exact: true }).click();
  await expect(page.getByTestId('kind')).toHaveText(['PNG']);
  await g.getByText('All', { exact: true }).click();
  await expect(page.getByTestId('kind')).toHaveCount(2);
});

test('test_svg_filter_requests_pd', async ({ page }) => {
  const urls = await setup(page);
  const g = page.getByRole('radiogroup', { name: 'Show' });
  await g.getByText('SVG', { exact: true }).click();
  await expect.poll(() => urls.length).toBe(2);
  expect(urls[1]).toContain('pd=1');
  await expect(page.getByText('SVG = public-domain icons (current TNP plan)')).toBeVisible();
  await g.getByText('All', { exact: true }).click();
  await expect.poll(() => urls.length).toBe(3);
  expect(urls[2]).not.toContain('pd');
});

test('test_png_fallback_icon',async ({ page }) => {
  await setup(page, { png: true });
  await addIcon(page);
});

test('test_png_url_revoked', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__made = []; (window as any).__rev = [];
    const c = URL.createObjectURL.bind(URL), r = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (b: any) => { const u = c(b); (window as any).__made.push(u); return u; };
    URL.revokeObjectURL = (u: string) => { (window as any).__rev.push(u); r(u); };
  });
  await setup(page, { png: true });
  await addIcon(page);
  const [made, rev] = await page.evaluate(() => [(window as any).__made, (window as any).__rev]);
  expect(made.length).toBe(1);
  expect(rev).toEqual(made);
});

test('test_search_error_and_loading', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route('**/api/search*', async (r) => { await gate; r.fulfill({ status: 502, json: { error: 'upstream down' } }); });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Search icons').fill('cat');
  await page.getByLabel('Search icons').press('Enter');
  await expect(page.getByRole('status')).toBeVisible();
  release();
  await expect(page.getByRole('alert')).toHaveText('upstream down');
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('test_empty_search_noop', async ({ page }) => {
  const urls = await setup(page);
  const n = urls.length;
  await page.getByLabel('Search icons').fill('   ');
  await page.getByLabel('Search icons').press('Enter');
  await page.waitForTimeout(200);
  expect(urls.length).toBe(n);
});

test('test_keys_ignored_in_input', async ({ page }) => {
  await setup(page);
  await addIcon(page);
  await page.getByLabel('Search icons').fill('x');
  await page.getByLabel('Search icons').press('Backspace');
  await page.getByLabel('Search icons').press('Control+z');
  await expect(count(page)).toHaveText('1');
});

test('test_no_horizontal_scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await setup(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('test_mirror_button', async ({ page }) => {
  await setup(page);
  const m = page.getByRole('button', { name: 'Mirror' });
  await expect(m).toHaveAttribute('aria-pressed', 'false');
  await m.click();
  await expect(m).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('mirror-guide')).toHaveCount(1);
  await page.locator('aside button img').first().click();
  await expect(count(page)).toHaveText('2');
});

test('test_shape_buttons', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Add circle' }).click();
  await expect(count(page)).toHaveText('1');
  for (const k of ['square', 'triangle', 'star', 'line']) await expect(page.getByRole('button', { name: `Add ${k}` })).toBeVisible();
});

test('test_clip_button_enabled_only_for_pair', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await setup(page);
  const clip = page.getByRole('button', { name: 'Clip' }), cut = page.getByRole('button', { name: 'Cut out' }), un = page.getByRole('button', { name: 'Unmask' });
  await expect(clip).toBeDisabled();
  await addIcon(page);
  await page.getByRole('button', { name: 'Add circle' }).click();
  await expect(count(page)).toHaveText('2');
  await expect(clip).toBeDisabled(); // only the circle is selected
  const b = (await page.locator('canvas.upper-canvas').boundingBox())!;
  await page.mouse.move(b.x + 5, b.y + 5);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 5, b.y + b.height - 5, { steps: 5 });
  await page.mouse.up();
  await expect(clip).toBeEnabled();
  await expect(cut).toBeEnabled();
  await expect(un).toBeDisabled();
  await clip.click();
  await expect(count(page)).toHaveText('1');
  await expect(clip).toBeDisabled();
  await expect(un).toBeEnabled();
  await un.click();
  await expect(count(page)).toHaveText('2');
  await expect(un).toBeDisabled();
});
