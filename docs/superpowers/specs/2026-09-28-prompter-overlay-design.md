# Prompter Overlay: Design Spec

Tanggal: 2026-09-28
Status: menunggu review

## 1. Latar dan tujuan

Pengguna membaca naskah yang sudah disiapkan (campuran Bahasa Indonesia dan Inggris) saat video call / screen share (Zoom, Meet, Teams). Dibutuhkan prompter yang:

- tampil sebagai overlay di atas aplikasi lain,
- tidak ikut terlihat oleh peserta saat layar dibagikan,
- transparansi latar dan tebal huruf dapat diatur,
- menggeser teks otomatis mengikuti apa yang sudah dibaca (voice-follow),
- dapat di-pause saat pengguna perlu berinteraksi dengan orang lain, lalu dilanjutkan dari posisi terakhir.

Non-tujuan (v1): sinkron multi-device, editor naskah kaya format, pengenalan suara offline, dukungan macOS/Linux.

## 2. User Story dan Acceptance Criteria

**US-01 Overlay tidak terlihat saat screen share**
Sebagai presenter, saya ingin prompter tampil di atas semua jendela tetapi tidak tertangkap screen share, agar peserta tidak melihat naskah saya.
- AC-01.01 Overlay selalu di atas jendela lain (always-on-top), termasuk di atas Zoom/Meet/Teams.
- AC-01.02 Saat berbagi layar penuh di Zoom/Meet/Teams, overlay tidak terlihat oleh peserta.
- AC-01.03 Overlay dapat dipindah dan diubah ukurannya.
- AC-01.04 Mode click-through dapat dinyalakan: klik menembus ke aplikasi di belakang, kecuali tombol kontrol overlay.

**US-02 Tampilan dapat diatur**
Sebagai presenter, saya ingin mengatur transparansi dan ketebalan tampilan agar nyaman dibaca tanpa menutupi layar.
- AC-02.01 Slider transparansi latar 0-100%, efek langsung terlihat.
- AC-02.02 Slider tebal huruf 300-900, efek langsung terlihat.
- AC-02.03 Ukuran font dan margin dapat diatur.
- AC-02.04 Semua pengaturan tersimpan dan dipulihkan saat aplikasi dibuka lagi.

**US-03 Naskah ditentukan dari awal**
Sebagai presenter, saya ingin memasukkan naskah sebelum mulai.
- AC-03.01 Naskah dapat ditempel langsung di control window.
- AC-03.02 Naskah dapat dimuat dari file .txt atau .md.
- AC-03.03 Naskah terakhir tersimpan otomatis dan muncul lagi saat aplikasi dibuka.

**US-04 Teks bergeser mengikuti bacaan**
Sebagai presenter, saya ingin teks bergeser otomatis sesuai yang sudah saya ucapkan.
- AC-04.01 Kata yang sudah dibaca diredupkan; baris aktif berada di garis baca (sekitar 1/3 dari atas).
- AC-04.02 Scroll mengikuti ucapan dengan jeda terasa di bawah 1 detik dalam kondisi internet normal.
- AC-04.03 Kata terlewat, salah dengar, dan kata Inggris yang ditulis menurut bunyinya tidak membuat posisi hilang.
- AC-04.04 Ucapan di luar naskah tidak menggeser posisi.
- AC-04.05 Mengulang 1-2 kalimat sebelumnya tetap diikuti dengan benar.
- AC-04.06 Kalimat yang muncul dua kali di naskah tidak menyebabkan lompatan ke kemunculan yang lebih jauh.

**US-05 Pause dan continue**
Sebagai presenter, saya ingin menjeda prompter saat berinteraksi dengan orang lalu melanjutkannya.
- AC-05.01 Tombol pause/continue di overlay tetap dapat diklik saat click-through aktif.
- AC-05.02 Shortcut global Ctrl+Shift+Space melakukan toggle pause/continue.
- AC-05.03 Saat pause, pengenalan suara benar-benar berhenti (mikrofon tidak dikirim ke layanan STT).
- AC-05.04 Saat pause, posisi beku, overlay menampilkan tanda PAUSED dan menyorot kalimat terakhir.
- AC-05.05 Saat continue, pelacakan dimulai lagi dari posisi yang dibekukan.
- AC-05.06 Auto-restart pengenalan suara tidak menyalakan mikrofon selama status pause.

**US-06 Kontrol manual dan fallback**
Sebagai presenter, saya ingin tetap bisa mengendalikan prompter saat pengenalan suara gagal.
- AC-06.01 Shortcut global maju/mundur satu kalimat.
- AC-06.02 Saat internet putus atau listener tidak terhubung, tersedia scroll kecepatan tetap dengan kecepatan yang bisa diatur.
- AC-06.03 Status (listener offline, mikrofon ditolak, jaringan error, posisi tidak ditemukan) ditampilkan sebagai indikator kecil, bukan popup.

## 3. Arsitektur

Stack: Electron + TypeScript, Vitest untuk unit test. Lokasi: `Github_Fahrudin/prompter/`.

```
Electron main process
  - overlay window: frameless, transparent, alwaysOnTop('screen-saver'),
    setContentProtection(true), setIgnoreMouseEvents(true, {forward:true}) saat click-through
  - control window: editor naskah, pengaturan, tombol buka listener
  - HTTP + WebSocket server lokal di 127.0.0.1:47821 (menyajikan listener.html)
  - globalShortcut, penyimpanan settings/naskah (JSON di userData)
  - state pause (sumber kebenaran tunggal)

Edge/Chrome tab: listener.html
  - webkitSpeechRecognition, lang id-ID, continuous, interimResults
  - kirim {type:'transcript', text, isFinal}; terima {type:'start'|'stop'}
  - auto-restart saat onend, kecuali diperintah stop

Overlay renderer
  - Tracker (murni) + ScriptView (DOM)
```

Alasan Web Speech via browser eksternal: Chromium di Electron tidak menyertakan kunci API Google, jadi `webkitSpeechRecognition` di dalam Electron tidak berfungsi. Edge/Chrome asli mendukung id-ID dengan jeda rendah dan beban CPU kecil. Konsekuensinya butuh internet.

## 4. Unit

| Unit | Tanggung jawab | Ketergantungan |
|---|---|---|
| `normalize` | teks -> token {raw, norm, phon}; lowercase, buang tanda baca, kunci fonetik sederhana (ee->i, oo->u, ph->f, c->k/s, y->i, konsonan ganda disederhanakan, h akhir dibuang) | tidak ada |
| `Tracker` | simpan token naskah dan posisi; `feed(text, isFinal)` -> posisi baru atau tidak berubah; `setPosition`, `nextSentence`, `prevSentence` | `normalize` |
| `SpeechSource` | interface `start()`, `stop()`, `onTranscript`, `onStatus` | - |
| `WebSpeechBridge` | implementasi `SpeechSource` via WebSocket | server WS di main |
| `ScriptView` | render kata sebagai span, redupkan yang sudah dibaca, scroll halus ke garis baca, tampilkan PAUSED dan status | DOM |
| `Settings` | baca/tulis settings dan naskah terakhir | fs |
| `AutoScroller` | scroll kecepatan tetap sebagai fallback | ScriptView |

### Algoritma Tracker

1. Ambil N token terakhir dari transkrip (N = 6 untuk interim, seluruh frasa untuk final, maksimum 12).
2. Jendela kandidat: posisi-5 sampai posisi+40.
3. Untuk tiap kandidat akhir `j`, hitung skor keselarasan transkrip terhadap naskah yang berakhir di `j` (mirip Smith-Waterman lokal): cocok persis = 2, cocok fonetik = 1.5, cocok dengan jarak edit kecil (<= 1 untuk kata <= 5 huruf, <= 2 untuk lebih panjang) = 1, lain = penalti -1; celah = -0.5.
4. Terima `j` terbaik jika skor >= 3 dan minimal 2 token cocok. Seri dipecahkan dengan memilih `j` terdekat dari posisi sekarang.
5. Interim hanya boleh memajukan posisi; final boleh memundurkan maksimal 5 token.
6. Tidak ada kecocokan > 10 detik -> status `lost` (posisi tetap).

## 5. Alur data

- Suara -> Edge -> WS -> main -> IPC -> overlay -> `Tracker.feed` -> `ScriptView.scrollTo`.
- Pause: overlay/shortcut -> main (set paused=true) -> WS `stop` -> Edge `recognition.stop()`, auto-restart dimatikan.
- Continue: main (paused=false) -> WS `start` -> Edge `recognition.start()`.
- Saat listener tersambung ulang, main mengirim status saat ini (`start` atau `stop`) agar tidak menyalakan mikrofon saat pause.

## 6. Penanganan error

| Kondisi | Perilaku |
|---|---|
| Listener tidak terhubung | status "Listener offline" + tombol buka listener di browser default |
| `not-allowed` / `service-not-allowed` | status merah + petunjuk izin mikrofon |
| `network` | fallback AutoScroller; kembali ke mode suara setelah transkrip berikutnya diterima |
| `no-speech` / `onend` | auto-restart bila tidak pause |
| Tidak cocok > 10 detik | petunjuk "posisi tidak ditemukan", kontrol manual tersedia |
| Port 47821 terpakai | coba port berikutnya sampai 47830; URL listener mengikuti |

## 7. Pengujian

- Unit (TDD, Vitest): `normalize` dan `Tracker` untuk skenario AC-04.03 s.d. AC-04.06, pause (tidak ada feed), kontrol manual.
- Integrasi: server WS dengan klien palsu (kirim transcript, terima start/stop, reconnect saat pause).
- Manual oleh pengguna: screen share Zoom/Meet (AC-01.02), baca naskah campur bahasa, pause/continue di tengah bacaan, putus internet.

## 8. Risiko

- `setContentProtection` hanya efektif di Windows 10 2004+; versi lama menampilkan kotak hitam. Mesin pengguna Windows 11, aman.
- Beberapa aplikasi rekam memakai metode capture yang berbeda; diverifikasi manual.
- Kualitas id-ID untuk kata Inggris bervariasi; ditangani oleh pencocokan fonetik dan jarak edit.
- Tab listener harus tetap terbuka; ditutup = mode suara berhenti (terdeteksi sebagai offline).
