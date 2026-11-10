// Menyusun artefak deploy Sites dari hasil build Worker dan UI.
// Pakai: npm run build:site
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const out = `${root}dist/site`;

if (!existsSync(`${root}dist/worker/worker.js`)) {
  console.error('dist/worker/worker.js belum ada. Jalankan `npm run build` dulu.');
  process.exit(1);
}
if (!existsSync(`${root}dist/ui/index.html`)) {
  console.error('dist/ui/index.html belum ada. Jalankan `npm run build` dulu.');
  process.exit(1);
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(`${root}dist/ui`, `${out}/ui`, { recursive: true });

// Wrangler meng-emit berkas .sql sebagai modul terpisah, bukan inline.
// Semua modul selain worker.js wajib ikut, kalau tidak bootstrap skema gagal saat runtime.
const emitted = await readdir(`${root}dist/worker`);
const sqlModules = emitted.filter((name) => name.endsWith('.sql'));

// Sites hanya menerima modul ber-ekstensi JS, teks, JSON, atau WASM. Berkas .sql
// ditolak walau tipenya "text", jadi modul dikirim sebagai .txt dan referensi
// impor di worker.js disesuaikan agar tetap menunjuk berkas yang benar.
const uploadedModules = sqlModules.map((name) => ({ source: name, uploaded: `${name}.txt` }));

let workerSource = await readFile(`${root}dist/worker/worker.js`, 'utf8');
for (const { source, uploaded } of uploadedModules) {
  const specifier = `./${source}`;
  if (!workerSource.includes(specifier)) {
    console.error(`worker.js tidak mereferensikan modul ${source}; artefak tidak konsisten.`);
    process.exit(1);
  }
  workerSource = workerSource.split(specifier).join(`./${uploaded}`);
}
await writeFile(`${out}/worker.js`, workerSource);

for (const { source, uploaded } of uploadedModules) {
  await cp(`${root}dist/worker/${source}`, `${out}/${uploaded}`);
}

const manifest = {
  entrypoint: 'worker.js',
  compatibilityDate: '2026-11-01',
  modules: [
    { name: 'worker.js', type: 'esm', path: './worker.js' },
    ...uploadedModules.map(({ uploaded }) => ({ name: uploaded, type: 'text', path: `./${uploaded}` }))
  ],
  assetsDirectory: './ui',
  spa: true
};

await writeFile(`${out}/site.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `Artefak Sites siap di dist/site (${manifest.entrypoint} + ${uploadedModules.length} modul teks + ui/).`
);
