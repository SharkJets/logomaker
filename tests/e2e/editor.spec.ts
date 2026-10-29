import { test, expect } from '@playwright/test';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h5v5H0z"/><path d="M5 5h5v5H5z"/></svg>';

async function run<T>(page: any, fn: (e: any) => Promise<T>): Promise<T> {
  return page.evaluate(async ([src, SVG]: [string, string]) => {
    const { createEditor } = await import('/src/lib/editor.ts');
    const c = document.createElement('canvas');
    document.body.append(c);
    const e = createEditor(c);
    return await (new Function('e', 'SVG', `return (${src})(e, SVG)`) as any)(e, SVG);
  }, [fn.toString(), SVG]);
}

test.beforeEach(async ({ page }) => { await page.goto("/"); await page.waitForLoadState("networkidle"); });

test('add, undo, redo, exportSVG', async ({ page }) => {
  const r = await run(page, async (e: any, SVG: string) => {
    await e.addSvg(SVG); const a = e.count();
    await e.undo(); const b = e.count();
    await e.redo(); const c = e.count();
    const s = e.exportSVG();
    return { a, b, c, xml: s.startsWith('<?xml'), svg: s.includes('<svg') };
  });
  expect(r).toEqual({ a: 1, b: 0, c: 1, xml: true, svg: true });
});

test('test_undo_no_history_feedback', async ({ page }) => {
  const r = await run(page, async (e: any, SVG: string) => {
    await e.addSvg(SVG);
    const counts: number[] = [];
    for (let i = 0; i < 3; i++) { await e.undo(); counts.push(e.count()); await e.redo(); counts.push(e.count()); }
    await e.undo(); counts.push(e.count());
    await e.undo(); counts.push(e.count());
    return counts;
  });
  expect(r).toEqual([0, 1, 0, 1, 0, 1, 0, 0]);
});

test('test_setColor_svg_group', async ({ page }) => {
  const n = await run(page, async (e: any, SVG: string) => {
    await e.addSvg(SVG); e.setColor('#ff0000');
    return (e.exportSVG().match(/fill: rgb[(]255,0,0[)]/g) || []).length;
  });
  expect(n).toBe(2);
});

test('test_png_export_after_image', async ({ page }) => {
  const s = await run(page, async (e: any) => {
    const oc = new OffscreenCanvas(20, 20);
    oc.getContext('2d')!.fillRect(0, 0, 20, 20);
    const url = URL.createObjectURL(await oc.convertToBlob({ type: 'image/png' }));
    await e.addImage(url); e.setColor('#00ff00');
    return e.exportPNG().slice(0, 14);
  });
  expect(s).toBe('data:image/png');
});

test('test_text', async ({ page }) => {
  const r = await run(page, async (e: any) => { e.addText('ACME', 'Impact'); return [e.count(), e.exportSVG().includes('ACME')]; });
  expect(r).toEqual([1, true]);
});

test('test_remove', async ({ page }) => {
  const n = await run(page, async (e: any, SVG: string) => { await e.addSvg(SVG); e.remove(); return e.count(); });
  expect(n).toBe(0);
});
