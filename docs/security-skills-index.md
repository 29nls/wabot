# Index Skill Keamanan untuk Wabot

Dokumen ini memetakan 17 dari 818 skill keamanan yang terpasang di `.claude/skills/` ke kebutuhan proyek Wabot: daemon Baileys, dashboard Worker, D1, R2, pair code, dan API bot.

**Cara pakai:** buka `SKILL.md` hanya saat tugasnya cocok. Skill adalah panduan, bukan skrip yang dijalankan otomatis. Skill ofensif hanya dipakai untuk pengujian pada sistem yang Anda miliki atau yang Anda punya izin tertulis untuk uji.

## Mulai dari lima ini

| Skill | Alasan |
| --- | --- |
| [testing-api-authentication-weaknesses](../.claude/skills/testing-api-authentication-weaknesses/SKILL.md) | Menguji Bearer bot, cookie dashboard, dan alur pair code terhadap token lemah serta endpoint tanpa autentikasi. |
| [implementing-api-key-security-controls](../.claude/skills/implementing-api-key-security-controls/SKILL.md) | Merancang `BOT_API_KEY` dengan entropi cukup, hash, scope, rotasi, dan deteksi kebocoran. |
| [testing-api-for-broken-object-level-authorization](../.claude/skills/testing-api-for-broken-object-level-authorization/SKILL.md) | Memastikan setiap query D1 discope ke grup dan bot yang berhak, bukan hanya ke JID dari klien. |
| [implementing-api-rate-limiting-and-throttling](../.claude/skills/implementing-api-rate-limiting-and-throttling/SKILL.md) | Menegakkan batas login, pairing, command, dan endpoint bot dengan algoritma yang benar. |
| [securing-serverless-functions](../.claude/skills/securing-serverless-functions/SKILL.md) | Menerapkan least privilege, secret management, validasi input, dan monitoring pada Worker. |

## 1. Autentikasi dan sesi

| Skill | Relevansi Wabot | Kapan dibuka |
| --- | --- | --- |
| [testing-api-authentication-weaknesses](../.claude/skills/testing-api-authentication-weaknesses/SKILL.md) | Menguji `/api/bot/*` yang memakai Bearer, cookie sesi dashboard, dan alur pair code terhadap validasi token lemah, session fixation, serta endpoint tanpa auth. | Saat merancang dan menguji M1 dan M2. |
| [implementing-api-key-security-controls](../.claude/skills/implementing-api-key-security-controls/SKILL.md) | `BOT_API_KEY` perlu entropi acak, penyimpanan aman, scope endpoint, rotasi dua kunci, dan pemantauan kebocoran di log atau repositori. | Saat membangun mekanisme autentikasi bot di M1. |
| [hunting-credential-stuffing-attacks](../.claude/skills/hunting-credential-stuffing-attacks/SKILL.md) | Login dashboard memakai satu password, sehingga pola percobaan berulang, ASN beragam, dan lonjakan kegagalan perlu terdeteksi. | Saat menambah rate limit dan alert login di M2. |

## 2. Otorisasi dan API

| Skill | Relevansi Wabot | Kapan dibuka |
| --- | --- | --- |
| [testing-api-for-broken-object-level-authorization](../.claude/skills/testing-api-for-broken-object-level-authorization/SKILL.md) | Endpoint seperti `/api/groups/:jid` dan `/api/bot/members/xp` harus memeriksa kepemilikan grup, bukan hanya mencocokkan ID dari request. | Saat review handler grup dan anggota di M3. |
| [implementing-api-rate-limiting-and-throttling](../.claude/skills/implementing-api-rate-limiting-and-throttling/SKILL.md) | PRD menetapkan pairing 3/15 menit, login 5/menit, command 5/10 detik, dan endpoint bot 120/menit. Skill ini membantu memilih token bucket atau sliding window yang tepat. | Saat implementasi middleware di M1 sampai M2. |
| [conducting-api-security-testing](../.claude/skills/conducting-api-security-testing/SKILL.md) | Checklist REST untuk autentikasi, otorisasi, rate limit, validasi input, dan business logic sebelum rilis. | Saat pengujian API menyeluruh di M4 dan M5. |

## 3. Dashboard dan D1

| Skill | Relevansi Wabot | Kapan dibuka |
| --- | --- | --- |
| [performing-web-application-penetration-test](../.claude/skills/performing-web-application-penetration-test/SKILL.md) | Dashboard memiliki form login, pengaturan grup, unggah aset, dan tampilan log. Metodologi WSTG mencakup XSS, CSRF, session, dan kontrol akses. | Saat menguji dashboard di M4. |
| [exploiting-sql-injection-vulnerabilities](../.claude/skills/exploiting-sql-injection-vulnerabilities/SKILL.md) | D1 tetap SQL. Semua query wajib parameterized, dan skill ini dipakai untuk menguji apakah masih ada interpolasi string. | Hanya untuk pengujian berizin di lingkungan sendiri, sebelum rilis M5. |
| [analyzing-api-gateway-access-logs](../.claude/skills/analyzing-api-gateway-access-logs/SKILL.md) | Log request Worker dapat dipakai untuk mendeteksi BOLA, bypass rate limit, dan pemindaian kredensial. | Saat menyusun format log dan alert di M5. |

## 4. Worker dan serverless

| Skill | Relevansi Wabot | Kapan dibuka |
| --- | --- | --- |
| [securing-serverless-functions](../.claude/skills/securing-serverless-functions/SKILL.md) | Prinsip least privilege, secret, validasi input, dan monitoring berlaku untuk Worker, meski contoh di skill memakai Lambda dan Cloud Functions. | Saat merancang binding D1, R2, dan env di M1. |
| [performing-serverless-function-security-review](../.claude/skills/performing-serverless-function-security-review/SKILL.md) | Review handler, environment variable, binding, dan jalur injeksi sebelum deploy produksi. | Saat audit keamanan Worker di M5. |
| [implementing-api-schema-validation-security](../.claude/skills/implementing-api-schema-validation-security/SKILL.md) | Satu skema validasi untuk body, query, dan parameter sebelum handler Hono menyentuh D1. Menutup gap DATA-02 dan DATA-03 (field tak dikenal, tipe salah). | Saat menambah endpoint baru di M2 sampai M4. |

## 5. Supply chain dan CI

| Skill | Relevansi Wabot | Kapan dibuka |
| --- | --- | --- |
| [detecting-malicious-npm-packages](../.claude/skills/detecting-malicious-npm-packages/SKILL.md) | Baileys dan dependensi Node lain berasal dari npm. Install script berbahaya dapat mencuri kredensial sebelum aplikasi dijalankan. | Setiap menambah atau memperbarui dependency, terutama Baileys. |
| [performing-sca-dependency-scanning-with-snyk](../.claude/skills/performing-sca-dependency-scanning-with-snyk/SKILL.md) | Lockfile Baileys, framework dashboard, dan tooling perlu dipindai CVE secara berkala di CI. | Saat menyiapkan pipeline M5. |
| [implementing-devsecops-security-scanning](../.claude/skills/implementing-devsecops-security-scanning/SKILL.md) | Semgrep, Gitleaks, Trivy, dan ZAP memberi lapisan SAST, secret scanning, dan DAST. | Saat menyiapkan CI dan pre-commit hook. |

## 6. Privasi dan insiden

| Skill | Relevansi Wabot | Kapan dibuka |
| --- | --- | --- |
| [performing-privacy-impact-assessment](../.claude/skills/performing-privacy-impact-assessment/SKILL.md) | Wabot menyimpan JID, push name, XP, dan log. PIA membantu memetakan aliran data, retensi, dan risiko privasi. | Saat memfinalkan model data dan kebijakan retensi. Sesuaikan kontrolnya dengan UU PDP, bukan hanya GDPR. |
| [containing-active-breach](../.claude/skills/containing-active-breach/SKILL.md) | Jika kredensial WhatsApp atau `BOT_API_KEY` bocor, langkah pertama adalah mencabut sesi, merotasi kunci, dan mengisolasi host. | Saat menyusun runbook insiden di M5. |

## Urutan pemakaian per milestone

| Milestone | Skill yang dipakai | Hasil |
| --- | --- | --- |
| M1 Control plane | API key, serverless, autentikasi API | Kunci bot dan handler Worker aman sejak awal |
| M2 Pairing | Autentikasi API, rate limit, credential stuffing | Pair code dan login tahan penyalahgunaan |
| M3 Fitur grup | BOLA, API security testing, schema validation | Scoping D1 per grup dan bot benar, field tak dikenal ditolak |
| M4 Dashboard | Web pentest, SQL injection | Dashboard lulus uji dasar sebelum dipakai |
| M5 Hardening | SCA, npm, DevSecOps, privasi, breach containment | Supply chain terpantau dan runbook insiden siap |

## Catatan

- Total 818 skill keamanan terpasang (dihitung dari `domain: cybersecurity` pada 961 `SKILL.md`). Index ini hanya memuat 17 yang paling dekat dengan arsitektur Wabot.
- **Tidak ada skill yang khusus membahas Hono, Cloudflare Workers, Wrangler, Miniflare, atau D1.** Pencarian nama folder dan isi `SKILL.md` untuk `hono`, `wrangler`, `workerd`, `miniflare`, `D1Database`, dan `durable object` menghasilkan nol skill yang benar-benar membahasnya. Satu-satunya kecocokan (`workerData` di `building-identity-governance-lifecycle-process`) adalah false positive.
- Karena itu, untuk Hono dan D1 pakai `securing-serverless-functions`, `performing-serverless-function-security-review`, dan `implementing-api-schema-validation-security`, lalu verifikasi manual di workerd lokal. Jangan menganggap contoh Lambda/Cloud Functions di skill tersebut otomatis berlaku untuk Workers.
- Skill Cloudflare yang ada bersifat platform, bukan runtime Worker: `implementing-ddos-mitigation-with-cloudflare` (ruleset dan rate limit edge) dan `deploying-cloudflare-access-for-zero-trust` (Access dan Tunnel). Keduanya belum masuk index karena baru relevan setelah domain final dan deploy, bukan untuk M1.
- Semua path mengikuti pola `.claude/skills/<nama>/SKILL.md`, dengan referensi tambahan di folder `references/` masing-masing skill.
- Perbarui index ini jika nama skill berubah setelah pembaruan repositori.
