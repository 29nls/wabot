import { pbkdf2Sync, randomBytes } from 'node:crypto';

const password = process.argv[2];

if (!password) {
  console.error('Usage: npm run hash-password -- "kata sandi"');
  process.exit(1);
}

// Cloudflare Workers menolak PBKDF2 di atas 100.000 iterasi, jadi nilai default
// harus tetap di batas itu agar hash yang dibuat bisa diverifikasi saat runtime.
const iterations = Number(process.argv[3] ?? 100000);
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256');

console.log(`pbkdf2$${iterations}$${salt.toString('base64url')}$${hash.toString('base64url')}`);
