import { Canvas, loadSVGFromString, util, FabricImage, IText, filters, Group } from 'fabric';
import { createHistory } from './history';

export type Editor = ReturnType<typeof createEditor>;

export function createEditor(el: HTMLCanvasElement) {
  const canvas = new Canvas(el, { width: 600, height: 600, backgroundColor: '#ffffff', preserveObjectStacking: true });
  const history = createHistory<string>();
  const snap = () => JSON.stringify(canvas.toJSON());
  let restoring = false;
  let q: Promise<void> = Promise.resolve();
  let cb = () => {};
  const changed = () => {
    if (restoring) return;
    history.push(snap());
    cb();
  };
  history.push(snap());
  canvas.on('object:added', changed);
  canvas.on('object:modified', changed);
  canvas.on('object:removed', changed);

  const place = (o: any) => {
    const s = Math.min(1, 200 / Math.max(o.width * (o.scaleX || 1), o.height * (o.scaleY || 1)));
    o.scale((o.scaleX || 1) * s);
    canvas.centerObject(o);
    canvas.add(o);
    o.setCoords();
    canvas.setActiveObject(o);
    canvas.requestRenderAll();
  };
  const restore = async (s: string | undefined) => {
    if (s === undefined) return;
    restoring = true;
    try { await canvas.loadFromJSON(JSON.parse(s)); canvas.requestRenderAll(); } finally { restoring = false; }
    cb();
  };
  const active = () => canvas.getActiveObject() as any;
  const paint = (o: any, color: string) => {
    if (o instanceof Group) o.getObjects().forEach((c: any) => paint(c, color));
    else if (o instanceof FabricImage) {
      o.filters = [new filters.BlendColor({ color, mode: 'tint', alpha: 1 })];
      o.applyFilters();
    } else {
      if (o.fill && o.fill !== 'none') o.set('fill', color);
      if (o.stroke && o.stroke !== 'none') o.set('stroke', color);
    }
  };

  return {
    async addSvg(svg: string) {
      const { objects, options } = await loadSVGFromString(svg);
      place(util.groupSVGElements(objects.filter(Boolean) as any, options));
    },
    async addImage(url: string) {
      place(await FabricImage.fromURL(url, { crossOrigin: 'anonymous' }));
    },
    addText(text: string, font: string) {
      place(new IText(text, { fontFamily: font, fontSize: 48, fill: '#000000' }));
    },
    setColor(hex: string) {
      const o = active();
      if (!o) return;
      paint(o, hex);
      o.dirty = true;
      canvas.fire('object:modified', { target: o } as any);
      canvas.requestRenderAll();
    },
    setFont(font: string) {
      const o = active();
      if (o instanceof IText) { o.set('fontFamily', font); canvas.fire('object:modified', { target: o } as any); canvas.requestRenderAll(); }
    },
    forward() { const o = active(); if (o) { canvas.bringObjectForward(o); changed(); } },
    backward() { const o = active(); if (o) { canvas.sendObjectBackwards(o); changed(); } },
    async duplicate() {
      const o = active();
      if (!o) return;
      const c = await o.clone();
      c.set({ left: o.left + 20, top: o.top + 20 });
      canvas.add(c);
      canvas.setActiveObject(c);
      canvas.requestRenderAll();
    },
    flip() { const o = active(); if (o) { o.set('flipX', !o.flipX); canvas.fire('object:modified', { target: o } as any); canvas.requestRenderAll(); } },
    remove() {
      const os = canvas.getActiveObjects();
      if (!os.length) return;
      canvas.discardActiveObject();
      restoring = true;
      try { os.forEach((o) => canvas.remove(o)); } finally { restoring = false; }
      changed();
    },
    undo() { return (q = q.then(() => restore(history.undo()))); },
    redo() { return (q = q.then(() => restore(history.redo()))); },
    exportSVG: () => canvas.toSVG(),
    exportPNG: () => canvas.toDataURL({ format: 'png', multiplier: 2 }),
    count: () => canvas.getObjects().length,
    onChange(f: () => void) { cb = f; },
  };
}
