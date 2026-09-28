# Prompter

Teleprompter overlay untuk Windows yang **mengikuti suara Anda**. Naskah tampil di atas aplikasi lain (Zoom, Google Meet, Teams, PowerPoint), **tidak ikut terlihat saat berbagi layar**, dan bergeser otomatis sesuai kata yang sudah Anda ucapkan. Mendukung naskah campuran Bahasa Indonesia dan Inggris.

## Fitur

- **Tersembunyi dari screen share.** Overlay memakai content protection Windows, jadi peserta meeting tidak melihat naskah Anda.
- **Voice-follow.** Kata yang sudah dibaca diredupkan dan baris aktif dijaga di garis baca (1/3 dari atas). Pelacakan tahan terhadap kata terlewat, salah dengar, istilah Inggris yang ditulis sesuai bunyinya, dan mengulang kalimat.
- **Jeda dan lanjut.** Saat jeda, mikrofon benar-benar berhenti, posisi dibekukan, dan kalimat terakhir disorot.
- **Kontrol manual.** Mundur/maju per kalimat, klik kata, geser slider progres, atau scroll mouse. Pelacakan suara melanjutkan dari posisi baru.
- **Auto-scroll cadangan.** Jika listener tidak tersambung atau jaringan error, teks bergulir dengan kecepatan tetap.
- **Tampilan bisa diatur.** Transparansi latar, tebal huruf, ukuran font, margin, mode selalu di atas, dan klik tembus. Semua pengaturan dan naskah terakhir tersimpan otomatis.

## Kebutuhan

- Windows 11, atau Windows 10 versi 2004 ke atas (dibutuhkan agar overlay tersembunyi dari screen share)
- Node.js 20 atau lebih baru
- Google Chrome atau Microsoft Edge (untuk pengenalan suara)
- Koneksi internet (pengenalan suara Web Speech berjalan di server Google)

## Mulai

```bash
npm install
npm start
```

`npm start` mem-build aplikasi lalu membuka dua jendela: **overlay** (tempat naskah) dan **Prompter — Kontrol**.

1. Tempel naskah di jendela Kontrol, atau klik **Muat dari file…** untuk file `.txt` / `.md`.
2. Klik **Buka listener di browser**. Tab listener terbuka di Chrome/Edge; izinkan akses mikrofon dan **biarkan tab itu tetap terbuka** selama sesi.
3. Mulai membaca. Teks di overlay bergeser mengikuti ucapan Anda.

## Menggunakan overlay

| Cara | Fungsi |
|---|---|
| **◀ / ▶** di bar atas | Mundur / maju satu kalimat |
| **Jeda / Lanjut** di bar atas | Hentikan atau lanjutkan pelacakan |
| **Klik kata** | Jadikan kata itu posisi saat ini |
| **Slider** di bawah | Geser ke bagian mana saja di naskah |
| **Scroll mouse** di atas teks | Kata yang berada di garis baca menjadi posisi baru |
| **Seret bar atas** | Pindahkan jendela overlay |

Setelah posisi dipindah manual, cukup ucapkan kata di posisi itu dan pelacakan langsung berlanjut. Anda juga boleh melewati beberapa kata awal kalimat.

Saat **klik tembus** aktif, klik dan scroll menembus ke aplikasi di belakang overlay. Bar atas dan slider tetap bisa dipakai.

### Shortcut

Berlaku di aplikasi mana pun:

| Shortcut | Fungsi |
|---|---|
| `Ctrl+Shift+Space` | Jeda / lanjut |
| `Ctrl+Shift+T` | Nyalakan / matikan mode selalu di atas |
| `Ctrl+Shift+→` | Maju satu kalimat |
| `Ctrl+Shift+←` | Mundur satu kalimat |

Saat jendela overlay aktif: `←` / `→` pindah kalimat, `Home` kembali ke awal, `Spasi` jeda / lanjut.

### Pengaturan (jendela Kontrol)

| Pengaturan | Rentang |
|---|---|
| Transparansi latar | 0–100% |
| Tebal huruf | 300–900 |
| Ukuran font | 16–72 px |
| Margin | 0–160 px |
| Kecepatan auto-scroll | 0–200 px/detik |
| Selalu di atas | nyala / mati (default nyala) |
| Klik tembus | nyala / mati |

Saat mode selalu di atas dimatikan, overlay berperilaku seperti jendela biasa: muncul di taskbar dan bisa dipilih lewat Alt+Tab. Overlay tetap tersembunyi dari screen share.

## Cara kerja

```
Chrome/Edge (listener.html)          Electron
  Web Speech API, id-ID   ──WS──▶   main process ──IPC──▶ overlay
  kirim transkrip                   (server lokal,         (Tracker + tampilan)
  terima start/stop       ◀──WS──    status jeda,
                                     shortcut, pengaturan)
```

- Pengenalan suara berjalan di tab Chrome/Edge sungguhan, karena Chromium bawaan Electron tidak menyertakan kunci API Google Speech.
- Main process menyajikan `listener.html` dan WebSocket di `127.0.0.1:47821` (mencoba port berikutnya sampai 47830 jika terpakai). Server hanya menerima koneksi dari komputer ini.
- Status jeda dipegang main process. Saat jeda, listener diperintah berhenti, dan listener yang tersambung ulang tidak akan menyalakan mikrofon selama masih jeda.
- `Tracker` mencocokkan kata yang didengar dengan naskah (skor cocok persis, cocok bunyi, dan jarak edit kecil) di sekitar posisi saat ini. Kata dari potongan ucapan sebelumnya dipakai sebagai konteks, karena Chrome sering mengirim ucapan per potongan pendek.

## Pengembangan

```bash
npm test          # unit & integration test (Vitest)
npm run typecheck # pemeriksaan TypeScript
npm run build     # build ke dist/ (tsc + esbuild)
```

```
src/
  core/        normalize (token + kunci fonetik), tracker (voice-follow)
  main/        entry Electron, jendela, shortcut, server HTTP/WS, pengaturan
  preload/     jembatan contextBridge untuk overlay & kontrol
  renderer/    UI overlay dan jendela kontrol
  shared/      tipe pesan dan nama kanal IPC
public/        listener.html (dibuka di Chrome/Edge)
tests/         test per modul
docs/          design spec dan rencana implementasi
```

Desain lengkap ada di [docs/superpowers/specs/2026-09-28-prompter-overlay-design.md](docs/superpowers/specs/2026-09-28-prompter-overlay-design.md).

## Masalah umum

- **Status "Listener offline".** Tab listener belum dibuka atau sudah ditutup. Klik **Buka listener di browser** di jendela Kontrol. Selama offline, teks bergulir dengan auto-scroll.
- **"Mikrofon ditolak".** Izinkan mikrofon untuk `127.0.0.1` di pengaturan situs Chrome/Edge, lalu muat ulang tab listener.
- **"Posisi tidak ditemukan".** Tidak ada kata yang cocok selama lebih dari 10 detik. Klik kata tempat Anda berada atau pakai ◀ / ▶, lalu lanjutkan membaca.
- **Shortcut tidak berfungsi.** Aplikasi lain mungkin sudah memakai kombinasi itu. Log aplikasi menampilkan `shortcut not available` untuk shortcut yang gagal didaftarkan. Selama prompter berjalan, `Ctrl+Shift+T` diambil alih dari browser (biasanya "buka ulang tab").
- **Overlay terlihat di screen share.** Pastikan Windows 10 versi 2004 atau lebih baru. Beberapa aplikasi perekam memakai metode capture berbeda, jadi uji dulu dengan akun kedua sebelum presentasi.

## Batasan

- Hanya Windows.
- Butuh internet untuk pengenalan suara.
- Tab listener harus tetap terbuka.
- Menutup salah satu jendela (overlay atau Kontrol) menutup seluruh aplikasi.
