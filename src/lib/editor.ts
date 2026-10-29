import { Canvas, loadSVGFromString, util, FabricImage, IText, filters, Group, ActiveSelection, Point } from 'fabric';
import { createHistory } from './history';

export type Editor = ReturnType<typeof createEditor>;

export function createEditor(el: HTMLCanvasElement) {
  const canvas = new Canvas(el, { width: 600, height: 600, backgroundColor: '#ffffff', preserveObjectStacking: true });
  const history = createHistory<string>();
  // custom props kept in history: uid = stable id, pair = partner's uid, mirrorOf = uid of the original (set on twins)
  const PROPS = ['uid', 'pair', 'mirrorOf'];
  const snap = () => JSON.stringify(canvas.toObject(PROPS));
  let restoring = false;
  let mirror = false;
  let q: Promise<void> = Promise.resolve();
  let cb = () => {};
  const changed = () => {
    if (restoring) return;
    history.push(snap());
    cb();
  };
  history.push(snap());
  const uid = (o: any) => (o.uid ||= Math.random().toString(36).slice(2) + Date.now().toString(36));
  canvas.on('object:added', ({ target }: any) => uid(target));
  const partner = (o: any) => (o.pair ? canvas.getObjects().find((x: any) => x.uid === o.pair) as any : undefined);
  const members = (t: any): any[] => (t instanceof ActiveSelection ? t.getObjects() : [t]);
  const link = (a: any, b: any) => {
    a.pair = uid(b); b.pair = uid(a); b.mirrorOf = a.uid;
  };
  // place p as o's reflection about x = 300 (uses absolute matrices, so it also works for ActiveSelection members)
  // ponytail: skew is not mirrored; add skewX = -skewX if skew handles get enabled
  const sync = (o: any, p: any) => {
    const d = util.qrDecompose(util.multiplyTransformMatrices([-1, 0, 0, 1, 600, 0], o.calcTransformMatrix()));
    const f = d.scaleY < 0;
    if (o instanceof IText) p.set({ text: o.text, fontFamily: o.fontFamily });
    p.set({ flipX: f, flipY: false, angle: (d.angle + (f ? 180 : 0)) % 360, scaleX: d.scaleX, scaleY: Math.abs(d.scaleY) });
    p.setPositionByOrigin(new Point(d.translateX, d.translateY), 'center', 'center');
    p.setCoords();
  };
  const syncAll = ({ target }: any) => {
    if (restoring || !target) return;
    const ms = members(target);
    ms.forEach((o) => { const p = partner(o); if (p && !ms.includes(p)) sync(o, p); });
    canvas.requestRenderAll();
  };
  // listeners registered before `changed` so the history snapshot already contains the synced partner
  ['object:moving', 'object:scaling', 'object:rotating', 'object:modified', 'text:changed'].forEach((ev) => canvas.on(ev as any, syncAll));
  const batch = (f: () => void) => { restoring = true; try { f(); } finally { restoring = false; } changed(); };
  const copy = async (o: any) => {
    if (!(o instanceof FabricImage)) return o.clone();
    const t = new FabricImage(o.getElement()); // clone() would reload the (possibly revoked) blob url
    t.filters = o.filters.slice();
    if (t.filters.length) t.applyFilters();
    return t;
  };
  const withPartners = (os: any[]) => [...new Set([...os, ...os.map(partner).filter(Boolean)])];
  canvas.on('object:added', changed);
  canvas.on('object:modified', changed);
  canvas.on('object:removed', changed);

  const place = (o: any, t?: any) => {
    const s = Math.min(1, 200 / Math.max(o.width * (o.scaleX || 1), o.height * (o.scaleY || 1)));
    o.scale((o.scaleX || 1) * s);
    canvas.centerObject(o);
    if (t) o.left -= 100; // centerX 200 so the pair does not overlap
    o.setCoords();
    if (t) { link(o, t); sync(o, t); batch(() => { canvas.add(o); canvas.add(t); }); } else canvas.add(o);
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
      const o = util.groupSVGElements(objects.filter(Boolean) as any, options);
      place(o, mirror ? await copy(o) : undefined);
    },
    async addImage(url: string) {
      const o = await FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
      place(o, mirror ? await copy(o) : undefined);
    },
    addText(text: string, font: string) {
      const mk = () => new IText(text, { fontFamily: font, fontSize: 48, fill: '#000000' });
      place(mk(), mirror ? mk() : undefined);
    },
    setColor(hex: string) {
      const o = active();
      if (!o) return;
      withPartners(members(o)).forEach((x) => { paint(x, hex); x.dirty = true; });
      canvas.fire('object:modified', { target: o } as any);
      canvas.requestRenderAll();
    },
    setFont(font: string) {
      const o = active();
      if (o instanceof IText) { [o, partner(o)].forEach((x) => x instanceof IText && x.set('fontFamily', font)); canvas.fire('object:modified', { target: o } as any); canvas.requestRenderAll(); }
    },
    forward() { const o = active(); if (o) { canvas.bringObjectForward(o); changed(); } },
    backward() { const o = active(); if (o) { canvas.sendObjectBackwards(o); changed(); } },
    async duplicate() {
      const o = active();
      if (!o) return;
      const c = await o.clone();
      c.set({ left: o.left + 20, top: o.top + 20 });
      if (mirror) {
        const t = await copy(c);
        link(c, t); c.setCoords(); sync(c, t);
        batch(() => { canvas.add(c); canvas.add(t); });
      } else canvas.add(c);
      canvas.setActiveObject(c);
      canvas.requestRenderAll();
    },
    flip() { const o = active(); if (o) { o.set('flipX', !o.flipX); canvas.fire('object:modified', { target: o } as any); canvas.requestRenderAll(); } },
    remove() {
      const os = canvas.getActiveObjects();
      if (!os.length) return;
      canvas.discardActiveObject();
      restoring = true;
      try { withPartners(os).forEach((o) => canvas.remove(o)); } finally { restoring = false; }
      changed();
    },
    isMirror: () => mirror,
    async setMirror(on: boolean) {
      if (on === mirror) return;
      mirror = on;
      const os = canvas.getObjects() as any[];
      if (on) {
        const todo = os.filter((o) => !o.pair);
        const twins = await Promise.all(todo.map(copy));
        todo.forEach((o, i) => { link(o, twins[i]); sync(o, twins[i]); });
        if (twins.length) batch(() => twins.forEach((t) => canvas.add(t)));
      } else if (os.some((o) => o.pair)) {
        batch(() => os.forEach((o) => { delete o.pair; delete o.mirrorOf; }));
      }
      canvas.requestRenderAll();
    },
    canvas,
    undo() { return (q = q.then(() => restore(history.undo()))); },
    redo() { return (q = q.then(() => restore(history.redo()))); },
    exportSVG: () => canvas.toSVG(),
    exportPNG: () => canvas.toDataURL({ format: 'png', multiplier: 2 }),
    count: () => canvas.getObjects().length,
    onChange(f: () => void) { cb = f; },
  };
}
