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

test('test_rapid_undo_serialized', async ({ page }) => {
  const r = await run(page, async (e: any, SVG: string) => {
    await e.addSvg(SVG); await e.addSvg(SVG);
    await Promise.all([e.undo(), e.undo()]);
    const a = e.count(); await e.redo(); await e.redo();
    return [a, e.count()];
  });
  expect(r).toEqual([0, 2]);
});

test('test_remove_undo_restores', async ({ page }) => {
  const r = await run(page, async (e: any, SVG: string) => {
    await e.addSvg(SVG); e.remove(); const a = e.count();
    await e.undo(); return [a, e.count()];
  });
  expect(r).toEqual([0, 1]);
});

// mirror (symmetry) mode. objs[0] = original, objs[1] = twin
test('test_mirror_creates_twin', async ({ page }) => {
  const r = await run(page, async (e: any, SVG: string) => {
    await e.addSvg(SVG);
    const [a] = e.canvas.getObjects(); a.left = 50; a.setCoords();
    await e.setMirror(true);
    const [, b] = e.canvas.getObjects();
    return { n: e.count(), on: e.isMirror(), sum: a.getCenterPoint().x + b.getCenterPoint().x, flip: b.flipX, dy: a.getCenterPoint().y - b.getCenterPoint().y };
  });
  expect(r.n).toBe(2); expect(r.on).toBe(true); expect(r.sum).toBeCloseTo(600); expect(r.flip).toBe(true); expect(r.dy).toBeCloseTo(0);
});

test('test_mirror_sync_move', async ({ page }) => {
  const x = await run(page, async (e: any, SVG: string) => {
    await e.setMirror(true); await e.addSvg(SVG);
    const [a, b] = e.canvas.getObjects(); const x0 = a.getCenterPoint().x;
    a.left -= 100; a.setCoords(); e.canvas.fire('object:modified', { target: a });
    return [x0, a.getCenterPoint().x, b.getCenterPoint().x];
  });
  expect(x[0]).toBeCloseTo(200); expect(x[1]).toBeCloseTo(100); expect(x[2]).toBeCloseTo(500);
});

test('test_mirror_vice_versa', async ({ page }) => {
  const x = await run(page, async (e: any, SVG: string) => {
    await e.setMirror(true); await e.addSvg(SVG);
    const [a, b] = e.canvas.getObjects();
    b.left += 30; b.setCoords(); e.canvas.fire('object:modified', { target: b });
    return a.getCenterPoint().x + b.getCenterPoint().x;
  });
  expect(x).toBeCloseTo(600);
});

test('test_mirror_color', async ({ page }) => {
  const n = await run(page, async (e: any, SVG: string) => {
    await e.setMirror(true); await e.addSvg(SVG); e.setColor('#ff0000');
    return (e.exportSVG().match(/fill: rgb[(]255,0,0[)]/g) || []).length;
  });
  expect(n).toBe(4);
});

test('test_mirror_remove', async ({ page }) => {
  const r = await run(page, async (e: any, SVG: string) => {
    await e.setMirror(true); await e.addSvg(SVG); e.remove(); const a = e.count();
    await e.undo(); return [a, e.count()];
  });
  expect(r).toEqual([0, 2]);
});

test('test_mirror_undo_keeps_link', async ({ page }) => {
  const r = await run(page, async (e: any, SVG: string) => {
    await e.setMirror(true); await e.addSvg(SVG);
    await e.undo(); await e.redo();
    const [a, b] = e.canvas.getObjects();
    a.left -= 100; a.setCoords(); e.canvas.fire('object:modified', { target: a });
    return [e.count(), a.getCenterPoint().x + b.getCenterPoint().x];
  });
  expect(r[0]).toBe(2); expect(r[1]).toBeCloseTo(600);
});

test('test_mirror_off_unlinks', async ({ page }) => {
  const r = await run(page, async (e: any, SVG: string) => {
    await e.addSvg(SVG); await e.setMirror(true); await e.setMirror(false);
    const [a, b] = e.canvas.getObjects(); const x0 = b.getCenterPoint().x;
    a.left -= 100; a.setCoords(); e.canvas.fire('object:modified', { target: a });
    return [e.count(), x0, b.getCenterPoint().x, e.isMirror()];
  });
  expect(r).toEqual([2, r[1], r[1], false]);
});

test('test_mirror_add_while_on', async ({ page }) => {
  const r = await run(page, async (e: any) => {
    await e.setMirror(true); e.addText('AB', 'Arial'); const a = e.count();
    await e.undo(); return [a, e.count()];
  });
  expect(r).toEqual([2, 0]);
});

test('test_mirror_text_edit_and_font', async ({ page }) => {
  const r = await run(page, async (e: any) => {
    await e.setMirror(true); e.addText('AB', 'Arial');
    const [a, b] = e.canvas.getObjects();
    a.set('text', 'ABCD'); e.canvas.fire('text:changed', { target: a });
    e.setFont('Georgia');
    return [b.text, b.fontFamily, a.getCenterPoint().x + b.getCenterPoint().x];
  });
  expect(r[0]).toBe('ABCD'); expect(r[1]).toBe('Georgia'); expect(r[2]).toBeCloseTo(600);
});

test('test_mirror_duplicate_gets_twin', async ({ page }) => {
  const r = await run(page, async (e: any, SVG: string) => {
    await e.setMirror(true); await e.addSvg(SVG); await e.duplicate();
    const [a, , c, d] = e.canvas.getObjects();
    return [e.count(), c.getCenterPoint().x + d.getCenterPoint().x, c.pair === d.uid, a.pair === c.uid];
  });
  expect(r[0]).toBe(4); expect(r[1]).toBeCloseTo(600); expect(r[2]).toBe(true); expect(r[3]).toBe(false);
});

test('test_mirror_selection_moves_partners', async ({ page }) => {
  const r = await run(page, async (e: any, SVG: string) => {
    await e.setMirror(true); await e.addSvg(SVG); await e.addSvg(SVG);
    const url = performance.getEntriesByType('resource').map((x) => x.name).find((n) => /deps\/fabric\.js/.test(n))!;
    const { ActiveSelection } = await import(url);
    const [a, b, c, d] = e.canvas.getObjects();
    const sel = new ActiveSelection([a, c], { canvas: e.canvas });
    e.canvas.setActiveObject(sel);
    sel.left -= 50; sel.setCoords(); e.canvas.fire('object:modified', { target: sel });
    return [a.getCenterPoint().x + b.getCenterPoint().x, c.getCenterPoint().x + d.getCenterPoint().x];
  });
  expect(r[0]).toBeCloseTo(600); expect(r[1]).toBeCloseTo(600);
});

test('test_mirror_image_after_blob_revoked', async ({ page }) => {
  const n = await run(page, async (e: any) => {
    const oc = new OffscreenCanvas(20, 20); oc.getContext('2d')!.fillRect(0, 0, 20, 20);
    const url = URL.createObjectURL(await oc.convertToBlob({ type: 'image/png' }));
    await e.addImage(url); URL.revokeObjectURL(url);
    await e.setMirror(true);
    return e.count();
  });
  expect(n).toBe(2);
});
