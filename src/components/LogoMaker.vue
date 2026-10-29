<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import type { Editor } from '../lib/editor';

type Icon = { id: string; thumb: string; attribution: string; svg: boolean };
const fonts = ['Arial', 'Georgia', 'Impact', 'Courier New', 'Trebuchet MS', 'Verdana'];

const canvasEl = ref<HTMLCanvasElement>();
const q = ref('');
const icons = ref<Icon[]>([]);
const kinds = ['All', 'SVG', 'PNG'] as const;
const kind = ref<(typeof kinds)[number]>('All');
const shown = computed(() => (kind.value === 'All' ? icons.value : icons.value.filter((i) => i.svg === (kind.value === 'SVG'))));
const next = ref<string | null>(null);
const count = ref(0);
const mirror = ref(false);
const color = ref('#000000');
const font = ref(fonts[0]);
const error = ref('');
const loading = ref(false);
let query = '';
let resolveEditor!: (e: Editor) => void;
const editorP = new Promise<Editor>((r) => (resolveEditor = r));

async function search(more = false, keep = false) {
  error.value = '';
  if (!more && !keep) query = q.value.trim();
  if (!query) return;
  // TNP-PLAN: free key only serves SVG for public-domain icons. On a paid plan, drop pd=1 and fetch SVGs via /v2/icon/{id}/download?filetype=svg&color=000000 in api/icon/[id].ts.
  const u = `/api/search?q=${encodeURIComponent(query)}` + (kind.value === 'SVG' ? '&pd=1' : '') + (more && next.value ? `&next=${encodeURIComponent(next.value)}` : '');
  loading.value = true;
  try {
    const r = await fetch(u);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `error ${r.status}`);
    const d = await r.json();
    icons.value = more ? [...icons.value, ...d.icons] : d.icons;
    next.value = d.next;
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

watch(kind, (n, o) => {
  if ((n === 'SVG') !== (o === 'SVG') && query) search(false, true);
});

async function add(i: Icon) {
  error.value = '';
  try {
    const r = await fetch(`/api/icon/${encodeURIComponent(i.id)}`);
    if (!r.ok) throw new Error(`icon error ${r.status}`);
    const ed = await editorP;
    if ((r.headers.get('content-type') || '').includes('image/svg+xml')) await ed.addSvg(await r.text());
    else {
      const url = URL.createObjectURL(await r.blob());
      try { await ed.addImage(url); } finally { URL.revokeObjectURL(url); }
    }
  } catch (e: any) {
    error.value = e.message;
  }
}

function download(href: string, name: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
}
async function exportSvg() {
  const url = URL.createObjectURL(new Blob([(await editorP).exportSVG()], { type: 'image/svg+xml' }));
  download(url, 'logo.svg');
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function exportPng() {
  download((await editorP).exportPNG(), 'logo.png');
}
async function toggleMirror() {
  mirror.value = !mirror.value;
  await (await editorP).setMirror(mirror.value);
}
const run = async (f: (e: Editor) => unknown) => { await f(await editorP); };

function onKey(ev: KeyboardEvent) {
  const t = ev.target as HTMLElement;
  if (t.closest('input, textarea, select, [contenteditable]')) return;
  const k = ev.key.toLowerCase();
  if (k === 'delete' || k === 'backspace') run((e) => e.remove());
  else if ((ev.ctrlKey || ev.metaKey) && k === 'z') { ev.preventDefault(); run((e) => e.undo()); }
  else if ((ev.ctrlKey || ev.metaKey) && k === 'y') { ev.preventDefault(); run((e) => e.redo()); }
}

onMounted(async () => {
  const { createEditor } = await import('../lib/editor');
  const ed = createEditor(canvasEl.value!);
  ed.onChange(() => (count.value = ed.count()));
  resolveEditor(ed);
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

const btn = 'rounded border border-gray-300 bg-white px-2 py-1 text-sm hover:bg-gray-100';
</script>

<template>
  <div class="flex h-full bg-gray-100">
    <aside class="flex w-80 shrink-0 flex-col border-r border-gray-300 bg-white p-3">
      <form class="mb-3" @submit.prevent="search()">
        <input v-model="q" type="search" aria-label="Search icons" placeholder="Search icons" class="w-full rounded border border-gray-300 px-2 py-1" />
      </form>
      <div role="radiogroup" aria-label="Show" class="mb-3 flex text-sm">
        <label v-for="k in kinds" :key="k" class="flex-1 cursor-pointer border border-gray-300 px-2 py-1 text-center has-[:checked]:bg-gray-800 has-[:checked]:text-white has-[:focus-visible]:ring-2">
          <input v-model="kind" type="radio" name="kind" :value="k" class="sr-only" />{{ k }}
        </label>
      </div>
      <p v-if="kind === 'SVG'" class="mb-2 text-xs text-gray-500">SVG = public-domain icons (current TNP plan)</p>
      <p v-if="loading" role="status" class="mb-2 text-sm text-gray-500">Loading…</p>
      <p v-if="error" role="alert" class="mb-2 text-sm text-red-600">{{ error }}</p>
      <div class="grid flex-1 grid-cols-4 content-start gap-1 overflow-y-auto">
        <p v-if="icons.length && !shown.length && kind !== 'All'" class="col-span-4 text-sm text-gray-500">No {{ kind }} results loaded - try Load more</p>
        <button v-for="i in shown":key="i.id" type="button" :title="i.attribution" class="relative rounded border border-gray-200 p-1 hover:bg-gray-100" @click="add(i)">
          <img :src="i.thumb" :alt="i.attribution" class="h-full w-full object-contain" />
          <span data-testid="kind" aria-hidden="true" :class="['absolute right-0 top-0 rounded-bl px-1 text-[10px] font-semibold leading-tight text-white', i.svg ? 'bg-emerald-600' : 'bg-amber-600']">{{ i.svg ? 'SVG' : 'PNG' }}</span>
        </button>
      </div>
      <button v-if="next" type="button" :class="[btn, 'mt-2']" @click="search(true)">Load more</button>
    </aside>
    <section class="flex flex-1 flex-col items-center gap-3 overflow-auto p-4">
      <div class="flex flex-wrap items-center gap-2">
        <input v-model="color" type="color" aria-label="Color" @input="run((e) => e.setColor(color))" />
        <select v-model="font" aria-label="Font" class="rounded border border-gray-300 px-1 py-1 text-sm" @change="run((e) => e.setFont(font))">
          <option v-for="f in fonts" :key="f" :value="f">{{ f }}</option>
        </select>
        <button type="button" :class="btn" @click="run((e) => e.addText('Text', font))">Add text</button>
        <button type="button" :class="btn" @click="run((e) => e.forward())">Forward</button>
        <button type="button" :class="btn" @click="run((e) => e.backward())">Back</button>
        <button type="button" :class="btn" @click="run((e) => e.duplicate())">Duplicate</button>
        <button type="button" :class="btn" @click="run((e) => e.flip())">Flip</button>
        <button type="button" :class="[btn, mirror && 'bg-gray-800 text-white hover:bg-gray-700']" :aria-pressed="mirror" @click="toggleMirror">Mirror</button>
        <button type="button" :class="btn" @click="run((e) => e.remove())">Delete</button>
        <button type="button" :class="btn" @click="run((e) => e.undo())">Undo</button>
        <button type="button" :class="btn" @click="run((e) => e.redo())">Redo</button>
        <button type="button" :class="btn" @click="exportPng">Export PNG</button>
        <button type="button" :class="btn" @click="exportSvg">Export SVG</button>
        <span class="text-sm text-gray-600">Objects: <span data-testid="count">{{ count }}</span></span>
      </div>
      <div class="relative shadow-lg">
        <canvas ref="canvasEl" />
        <div v-if="mirror" data-testid="mirror-guide" aria-hidden="true" class="pointer-events-none absolute inset-y-0 left-1/2 border-l border-dashed border-gray-400/70" />
      </div>
    </section>
  </div>
</template>
