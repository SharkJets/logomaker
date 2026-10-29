import { Canvas, loadSVGFromString, util, FabricImage, IText, filters, Group, ActiveSelection, Point, Rect, Circle, Triangle, Polygon, Line } from 'fabric';
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
    let t: any;
    if (!(o instanceof FabricImage)) t = await o.clone();
    else {
      t = new FabricImage(o.getElement()); // clone() would reload the (possibly revoked) blob url
      t.filters = o.filters.slice();
      if (t.filters.length) t.applyFilters();
    }
    if (o.clipPath) t.clipPath = await o.clipPath.clone(); // clip is local to its object, so the twin's mirrored matrix already mirrors it
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
  let onSel = () => {};
  ['selection:created', 'selection:updated', 'selection:cleared'].forEach((ev) => canvas.on(ev as any, () => onSel()));
  // shapes are recognised by class; ponytail: an imported SVG that is a single <rect>/<circle> also counts as a shape
  const isShape = (o: any) => [Rect, Circle, Triangle, Polygon, Line].some((C) => o instanceof C);
  // the 2-object selection to mask: the topmost shape masks the other object
  const maskPair = () => {
    const s = active();
    if (!(s instanceof ActiveSelection) || s.getObjects().length !== 2) return;
    const all = canvas.getObjects();
    const shape = s.getObjects().filter(isShape).sort((a: any, b: any) => all.indexOf(b) - all.indexOf(a))[0];
    return shape && { shape, target: s.getObjects().find((o: any) => o !== shape) };
  };
  const star = Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 ? 30 : 75, a = (i * Math.PI) / 5 - Math.PI / 2;
    return { x: 75 + r * Math.cos(a), y: 75 + r * Math.sin(a) };
  });
  const shapes = {
    square: () => new Rect({ width: 150, height: 150, fill: '#111111' }),
    circle: () => new Circle({ radius: 75, fill: '#111111' }),
    triangle: () => new Triangle({ width: 150, height: 150, fill: '#111111' }),
    star: () => new Polygon(star, { fill: '#111111' }),
    line: () => new Line([0, 0, 150, 0], { stroke: '#111111', strokeWidth: 8 }),
  };
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
    addShape(kind: keyof typeof shapes) {
      place(shapes[kind](), mirror ? shapes[kind]() : undefined);
    },
    canMask: () => !!maskPair(),
    async mask(mode: 'clip' | 'cut') {
      const m = maskPair();
      if (!m) return;
      const { shape, target } = m;
      const tp = partner(target);
      canvas.discardActiveObject(); // members get absolute coordinates back
      const twin = tp && (await shape.clone());
      if (twin) sync(shape, twin);
      const sp = partner(shape);
      restoring = true;
      try {
        [[target, shape], [tp, twin]].forEach(([t, s]) => {
          if (!t) return;
          util.applyTransformToObject(s, util.multiplyTransformMatrices(util.invertTransform(t.calcTransformMatrix()), s.calcTransformMatrix()));
          s.set({ absolutePositioned: false, inverted: mode === 'cut' });
          t.clipPath = s; t.dirty = true;
        });
        canvas.remove(shape);
        if (tp && sp) canvas.remove(sp);
      } finally { restoring = false; }
      canvas.setActiveObject(target);
      changed();
    },
    canUnmask: () => !!active()?.clipPath,
    unmask() {
      const o = active();
      if (!o?.clipPath) return;
      restoring = true;
      try {
        const back = [o, partner(o)].filter((x) => x?.clipPath).map((x) => {
          const s = x.clipPath;
          x.clipPath = undefined; x.dirty = true;
          util.applyTransformToObject(s, util.multiplyTransformMatrices(x.calcTransformMatrix(), s.calcTransformMatrix()));
          s.set({ absolutePositioned: false, inverted: false }); s.setCoords();
          canvas.add(s);
          return s;
        });
        if (back.length === 2) link(back[0], back[1]);
      } finally { restoring = false; }
      changed();
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
    exportSVG() {
      // SVG <clipPath> cannot invert, so "cut" clips are exported as <mask> (white rect + black shape)
      const cuts = canvas.getObjects().map((o: any) => o.clipPath).filter((c: any) => c?.inverted);
      const saved = cuts.map((c: any) => ({ fill: c.fill, stroke: c.stroke, f: c.toClipPathSVG }));
      cuts.forEach((c: any, i: number) => {
        if (c.fill) c.fill = '#000000';
        if (c.stroke) c.stroke = '#000000';
        c.toClipPathSVG = (r?: any) => '<!--cut-->' + saved[i].f.call(c, r);
      });
      let svg: string;
      try { svg = canvas.toSVG(); } finally {
        cuts.forEach((c: any, i: number) => { c.fill = saved[i].fill; c.stroke = saved[i].stroke; c.toClipPathSVG = saved[i].f; });
      }
      const ids = new Set<string>();
      // the mask lives in the object's local space (inside its transformed <g>), so the white rect/region must be huge, not canvas-sized
      const B = 100000, box = `x="${-B}" y="${-B}" width="${2 * B}" height="${2 * B}"`;
      return svg
        .replace(/<clipPath id="([^"]+)" >\n<!--cut-->([\s\S]*?)<\/clipPath>/g, (_, id, body) => {
          ids.add(id);
          return `<mask id="${id}" maskUnits="userSpaceOnUse" ${box}>
<rect ${box} fill="#ffffff"/>
${body}</mask>`;
        })
        .replace(/clip-path="url\(#([^)]+)\)"/g, (m, id) => (ids.has(id) ? `mask="url(#${id})"` : m));
    },
    exportPNG: () => canvas.toDataURL({ format: 'png', multiplier: 2 }),
    count: () => canvas.getObjects().length,
    onChange(f: () => void) { cb = f; },
    onSelect(f: () => void) { onSel = f; },
  };
}
