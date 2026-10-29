import { test, expect } from '@playwright/test';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h5v5H0z"/><path d="M5 5h5v5H5z"/></svg>';

// 200x200 black square: placed unscaled, centred, bbox 200..400
const SQ = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><path d="M0 0h200v200H0z"/></svg>';

async function run<T>(page: any, fn: (e: any, SVG: string, H: any) => Promise<T>): Promise<T> {
  return page.evaluate(async ([src, SVG, SQ]: [string, string, string]) => {
    const { createEditor } = await import('/src/lib/editor.ts');
    const c = document.createElement('canvas');
    document.body.append(c);
    const e = createEditor(c);
    // H.sel: select objects; H.px: rgba at canvas coords (x, y) of a png/svg url
    const H: any = {
      SQ,
      sel: async (...os: any[]) => {
        const url = performance.getEntriesByType('resource').map((x) => x.name).find((n) => /deps\/fabric\.js/.test(n))!;
        const { ActiveSelection } = await import(url);
        const s = new ActiveSelection(os, { canvas: e.canvas });
        e.canvas.setActiveObject(s);
        return s;
      },
      // mask the icon with a circle, then move the icon +100px in x and fire modified
      moved: async (mode: string) => {
        await e.addSvg(SQ); e.addShape('circle');
        const [a, b] = e.canvas.getObjects();
        await H.sel(a, b); await e.mask(mode);
        const o = e.canvas.getObjects()[0];
        o.set('left', o.left + 100); o.setCoords(); e.canvas.fire('object:modified', { target: o });
      },
      px: (url: string, x: number, y: number) => new Promise<number[]>((res, rej) => {
        const i = new Image();
        i.onerror = () => rej(new Error('image failed'));
        i.onload = () => {
          const c = document.createElement('canvas'); c.width = i.width; c.height = i.height;
          const g = c.getContext('2d')!; g.drawImage(i, 0, 0);
          const k = i.width / 600;
          res(Array.from(g.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data));
        };
        i.src = url;
      }),
    };
    return await (new Function('e', 'SVG', 'H', `return (${src})(e, SVG, H)`) as any)(e, SVG, H);
  }, [fn.toString(), SVG, SQ]);
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

// shapes + masking. Icon bbox is 200..400; the circle shape is centred with radius 75, so (205,205) is outside it.
const isBg = (p: number[]) => p[0] > 240 && p[1] > 240 && p[2] > 240;
const isInk = (p: number[]) => p[0] < 20 && p[1] < 20 && p[2] < 20;

test('test_add_shapes', async ({ page }) => {
  const r = await run(page, async (e: any) => {
    const counts: number[] = [];
    for (const k of ['square', 'circle', 'triangle', 'star', 'line']) { e.addShape(k); counts.push(e.count()); }
    return counts;
  });
  expect(r).toEqual([1, 2, 3, 4, 5]);
});

test('test_mask_clip', async ({ page }) => {
  const r = await run(page, async (e: any, _: string, H: any) => {
    await e.addSvg(H.SQ); e.addShape('circle');
    const [a, b] = e.canvas.getObjects();
    await H.sel(a, b);
    const can = e.canMask(); await e.mask('clip');
    const png = e.exportPNG();
    const c = e.canvas.getObjects()[0].clipPath;
    return { can, n: e.count(), has: !!c, inv: !!c.inverted, abs: c.absolutePositioned, corner: await H.px(png, 205, 205), mid: await H.px(png, 300, 300) };
  });
  expect(r).toMatchObject({ can: true, n: 1, has: true, inv: false, abs: false });
  expect(isBg(r.corner)).toBe(true); expect(isInk(r.mid)).toBe(true);
});

test('test_mask_cut', async ({ page }) => {
  const r = await run(page, async (e: any, _: string, H: any) => {
    await e.addSvg(H.SQ); e.addShape('circle');
    const [a, b] = e.canvas.getObjects();
    await H.sel(a, b); await e.mask('cut');
    const png = e.exportPNG();
    return { n: e.count(), inv: e.canvas.getObjects()[0].clipPath.inverted, corner: await H.px(png, 205, 205), mid: await H.px(png, 300, 300) };
  });
  expect(r).toMatchObject({ n: 1, inv: true });
  expect(isInk(r.corner)).toBe(true); expect(isBg(r.mid)).toBe(true);
});

test('test_mask_needs_a_pair_with_a_shape', async ({ page }) => {
  const r = await run(page, async (e: any, _: string, H: any) => {
    await e.addSvg(H.SQ); await e.addSvg(H.SQ);
    const [a, b] = e.canvas.getObjects();
    const none = e.canMask();
    await H.sel(a, b); const noShape = e.canMask(); await e.mask('clip');
    return [none, noShape, e.count()];
  });
  expect(r).toEqual([false, false, 2]);
});

test('test_mask_undo', async ({ page }) => {
  const r = await run(page, async (e: any, _: string, H: any) => {
    await e.addSvg(H.SQ); e.addShape('circle');
    const [a, b] = e.canvas.getObjects();
    await H.sel(a, b); await e.mask('cut');
    await e.undo();
    const undone = [e.count(), e.canvas.getObjects().some((o: any) => o.clipPath)];
    await e.redo();
    const c = e.canvas.getObjects()[0].clipPath;
    const png = e.exportPNG();
    return { undone, n: e.count(), inv: c?.inverted, abs: c?.absolutePositioned, mid: await H.px(png, 300, 300) };
  });
  expect(r.undone).toEqual([2, false]);
  expect(r).toMatchObject({ n: 1, inv: true, abs: false });
  expect(isBg(r.mid)).toBe(true);
});

test('test_unmask', async ({ page }) => {
  const r = await run(page, async (e: any, _: string, H: any) => {
    await e.addSvg(H.SQ); e.addShape('circle');
    const [a, b] = e.canvas.getObjects();
    await H.sel(a, b); await e.mask('clip');
    const can = e.canUnmask(); e.unmask();
    const [, s] = e.canvas.getObjects();
    const after = [e.count(), e.canvas.getObjects().some((o: any) => o.clipPath), e.canUnmask(), s.getCenterPoint().x, s.getCenterPoint().y];
    await e.undo();
    return { can, after, undone: e.count() };
  });
  expect(r.can).toBe(true);
  expect(r.after.slice(0, 3)).toEqual([2, false, false]);
  expect(r.after[3]).toBeCloseTo(300); expect(r.after[4]).toBeCloseTo(300);
  expect(r.undone).toBe(1);
});

test('test_cut_svg_export', async ({ page }) => {
  const r = await run(page, async (e: any, _: string, H: any) => {
    await e.addSvg(H.SQ); e.addShape('circle');
    const [a, b] = e.canvas.getObjects();
    await H.sel(a, b); await e.mask('cut');
    const svg = e.exportSVG();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const again = e.exportSVG(); // export must not leave the clipPath patched
    return { mask: svg.includes('<mask'), clip: svg.includes('<clipPath'), same: again.replace(/\d+/g, '') === svg.replace(/\d+/g, ''), hole: await H.px(url, 300, 300), corner: await H.px(url, 205, 205), still: e.canvas.getObjects()[0].clipPath.inverted };
  });
  expect(r).toMatchObject({ mask: true, clip: false, same: true, still: true });
  expect(isBg(r.hole)).toBe(true); expect(isInk(r.corner)).toBe(true);
});

test('test_clip_svg_export_keeps_clippath', async ({ page }) => {
  const r = await run(page, async (e: any, _: string, H: any) => {
    await e.addSvg(H.SQ); e.addShape('circle');
    const [a, b] = e.canvas.getObjects();
    await H.sel(a, b); await e.mask('clip');
    const svg = e.exportSVG();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    return { mask: svg.includes('<mask'), clip: svg.includes('<clipPath'), mid: await H.px(url, 300, 300), corner: await H.px(url, 205, 205) };
  });
  expect(r).toMatchObject({ mask: false, clip: true });
  expect(isInk(r.mid)).toBe(true); expect(isBg(r.corner)).toBe(true);
});

test('test_mask_mirror_and_duplicate', async ({ page }) => {
  const r = await run(page, async (e: any, _: string, H: any) => {
    await e.setMirror(true); await e.addSvg(H.SQ); e.addShape('circle');
    const [a, , c] = e.canvas.getObjects(); // icon, twin, circle, circle twin
    await H.sel(a, c); await e.mask('clip');
    const [i, t] = e.canvas.getObjects();
    const cx = (o: any) => { const m = o.calcTransformMatrix(), c = o.clipPath.calcTransformMatrix(); return m[0] * c[4] + m[2] * c[5] + m[4]; };
    const out = { n: e.count(), sum: cx(i) + cx(t), twinClip: !!t.clipPath };
    e.canvas.setActiveObject(i); await e.duplicate();
    const [, , d] = e.canvas.getObjects();
    return { ...out, n2: e.count(), dx: cx(d) - cx(i), left: d.left - i.left };
  });
  expect(r).toMatchObject({ n: 2, twinClip: true, n2: 4 });
  expect(r.sum).toBeCloseTo(600); expect(r.dx).toBeCloseTo(20); expect(r.left).toBeCloseTo(20);
});

// masks live in the object's local space, so they travel with it (icon bbox 200..400, circle r75 at 300; moved +100 -> centre 400)
test('test_mask_moves_with_object', async ({ page }) => {
  const r = await run(page, async (e: any, _: string, H: any) => {
    await H.moved( 'clip');
    const png = e.exportPNG();
    return { now: await H.px(png, 400, 300), old: await H.px(png, 250, 300) };
  });
  expect(isInk(r.now)).toBe(true); expect(isBg(r.old)).toBe(true);
});

test('test_cut_moves_with_object', async ({ page }) => {
  const r = await run(page, async (e: any, _: string, H: any) => {
    await H.moved( 'cut');
    const png = e.exportPNG();
    return { now: await H.px(png, 400, 300), old: await H.px(png, 310, 300) };
  });
  expect(isBg(r.now)).toBe(true); expect(isInk(r.old)).toBe(true);
});

test('test_unmask_after_move', async ({ page }) => {
  const r = await run(page, async (e: any, _: string, H: any) => {
    await H.moved( 'clip'); e.unmask();
    const s = e.canvas.getObjects()[1].getCenterPoint();
    return [s.x, s.y];
  });
  expect(r[0]).toBeCloseTo(400); expect(r[1]).toBeCloseTo(300);
});

test('test_cut_svg_after_move', async ({ page }) => {
  const r = await run(page, async (e: any, _: string, H: any) => {
    await H.moved( 'cut');
    const url = URL.createObjectURL(new Blob([e.exportSVG()], { type: 'image/svg+xml' }));
    return { now: await H.px(url, 400, 300), old: await H.px(url, 310, 300) };
  });
  expect(isBg(r.now)).toBe(true); expect(isInk(r.old)).toBe(true);
});
