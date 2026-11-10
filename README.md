# Wabot Control Plane

Fondasi control plane Wabot untuk `*.freebuff.page`: Worker, skema D1, autentikasi password tunggal, dan dashboard login.

Cakupan saat ini adalah milestone M1:

- Worker dengan health check, login, sesi, logout, dan header keamanan.
- Migrasi D1 untuk 10 tabel PRD dan rate limit login.
- Dashboard React untuk login, guard sesi, dan status sistem.
- Cookie sesi HttpOnly dengan CSRF untuk mutasi.

Pairing (permintaan dan transisi status dari dashboard dan daemon, halaman `/pair`), serta endpoint `/api/bot/*` dilindungi `BOT_API_KEY`. Daemon Baileys, R2, dan halaman grup belum termasuk dalam fondasi ini.

## Stack

- Cloudflare Worker dengan Hono.
- D1 untuk konfigurasi dan rate limit.
- React 19 dan Vite untuk dashboard.
- TypeScript strict dan Vitest.
- Wrangler untuk pengembangan lokal.

## Setup

```bash
npm install
npm run db:migrate:local
```

Buat hash password dashboard:

```bash
npm run hash-password -- "kata sandi lokal"
```

Salin `.dev.vars.example` menjadi `.dev.vars`, lalu isi:

```dotenv
DASHBOARD_PASSWORD_HASH=pbkdf2$100000$...
SESSION_SECRET=64-hex-character-random-secret
APP_ORIGIN=http://localhost:8787
BOT_API_KEY=kunci-acak-untuk-endpoint-bot
```

`.dev.vars` tidak boleh di-commit. Untuk produksi, nilai yang sama disimpan sebagai secret Worker, bukan di file repo. `BOT_API_KEY` wajib diatur sebagai secret environment sebelum endpoint `/api/bot/*` bisa digunakan.

## Menjalankan lokal

```bash
npm run dev
```

Perintah ini membangun UI ke `dist/ui`, lalu menjalankan Wrangler di `http://localhost:8787`.

Health check:

```bash
curl -i http://localhost:8787/api/health
```

Login membutuhkan header `Origin` yang cocok dengan `APP_ORIGIN`:

```bash
curl -i -X POST http://localhost:8787/api/auth/login \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:8787' \
  --data '{"password":"kata sandi lokal"}'
```

## Perintah

```bash
npm run typecheck
npm test
npm run build
npm run build:site
npm run db:migrate:local
```

`npm run build` menghasilkan aset dashboard di `dist/ui` dan bundle Worker di `dist/worker`. `npm run build:site` menjalankan `build` lebih dulu, lalu merangkum hasilnya menjadi artefak deploy Sites di `dist/site` (`worker.js`, modul `.sql`, `ui/`, dan manifest `site.json`). Modul `.sql` wajib ikut karena Wrangler meng-emitnya sebagai berkas terpisah, bukan inline; bootstrap skema membacanya saat runtime.

## Migrasi

- `migrations/0001_init.sql`: tabel `bots`, `pair_requests`, `groups`, `group_settings`, `members`, `commands`, `audit_log`, `events`, `media_files`, `daily_stats`, plus indeks dan baris bot awal.
- `migrations/0002_auth_rate_limits.sql`: tabel `rate_limits` untuk login 5 percobaan per menit per IP.

Semua DDL memakai `IF NOT EXISTS` sehingga aman dijalankan ulang. Sumber kebenaran SQL tetap berkas di `migrations/`; Worker mengimpornya langsung sebagai teks sehingga tidak ada DDL yang diduplikasi ke TypeScript.

### Bootstrap skema di database baru

Sites tidak menyediakan eksekusi SQL langsung ke D1 dan Wrangler lokal belum tentu terautentikasi, jadi database baru disiapkan dari dalam Worker:

1. Setel secret `SCHEMA_BOOTSTRAP=true` pada environment tersebut.
2. Buka dashboard dan login. Login memanggil `ensureSchema` sebelum menyentuh `rate_limits`, sehingga database kosong tidak lagi berujung `500`.
3. Setelah `GET /api/health` melaporkan `schema: ok`, kembalikan `SCHEMA_BOOTSTRAP` ke `false`.

`POST /api/admin/schema` juga tersedia untuk memicu bootstrap secara eksplisit; endpoint ini menuntut sesi login, token CSRF, origin yang sama, dan flag `SCHEMA_BOOTSTRAP=true`.

Migrasi dicatat di tabel `schema_migrations` dan dijalankan dalam satu `db.batch()` sehingga atomik. Bila proses lain sedang menjalankan migrasi, kunci di `schema_migrations` mencegah dua penerapan paralel; pemanggilan berikutnya cukup mengembalikan `applied: []`.

Tanpa flag tersebut, login pada database kosong menjawab `503 schema_missing` alih-alih `500` generik, sehingga penyebabnya jelas.

## Keamanan

- Password dashboard diverifikasi dengan PBKDF2-SHA256 minimal 100.000 iterasi.
- Sesi ditandatangani HMAC-SHA256, berlaku 7 hari, dan disimpan dalam cookie `HttpOnly`, `Secure` di HTTPS, serta `SameSite=Lax`.
- Login dan logout wajib same-origin. Logout juga wajib menyertakan `X-CSRF-Token`.
- Rate limit login disimpan di D1 agar tidak hilang antar isolate.
- Respons API memakai `Cache-Control: no-store` dan tidak mengaktifkan CORS.
- CSP, `nosniff`, `no-referrer`, dan pembatasan permissions dipasang di Worker.

## Deployment

Preview Sites sudah berjalan di `https://site-7d87b1be2d4b43b1b96caf101f31144d.freebuff.page` (environment preview, bukan production). Langkah untuk environment berikutnya:

1. Sediakan database D1 dengan binding `DB` lewat Sites.
2. `npm run build:site`, lalu deploy `dist/site/site.json` melalui Sites.
3. Isi secret `DASHBOARD_PASSWORD_HASH`, `SESSION_SECRET`, dan `BOT_API_KEY` (untuk endpoint `/api/bot/*`). `APP_ORIGIN` di-inject otomatis oleh Sites sebagai variabel reserved; tanpa variabel itu Worker memakai origin request sebagai acuan same-origin.
4. Setel `SCHEMA_BOOTSTRAP=true`, lalu login sekali agar skema terbentuk.
5. Pastikan `GET /api/health` melaporkan `schema: ok`, lalu setel `SCHEMA_BOOTSTRAP=false`.

Catatan:

- `/api/health` tetap `200` walaupun skema belum ada, tetapi statusnya `degraded` dengan `schema: missing`. Tanpa bootstrap, login gagal karena tabel `bots` dan `rate_limits` belum ada.
- Hash password wajib memakai 100.000 iterasi. Cloudflare Workers menolak PBKDF2 di atas 100.000, sehingga hash 210.000 iterasi selalu gagal diverifikasi di runtime meskipun valid secara lokal.
- Endpoint `/api/bot/*` meminta header `Authorization: Bearer <BOT_API_KEY>` dan tidak menampilkan header `Access-Control-Allow-Origin` (tanpa CORS).
- Sites hanya menerima modul ber-ekstensi JS/teks/JSON/WASM, jadi `build-site.mjs` mengunggah modul `.sql` sebagai `.txt` dan menulis ulang specifier impor di `worker.js`.

Jangan menaruh nilai secret di `wrangler.jsonc`, README, atau aset publik.
