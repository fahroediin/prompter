import { describe, it, expect } from 'vitest';
import { Tracker } from '../../src/core/tracker';

const SCRIPT =
  'Selamat pagi semua. Hari ini kita membahas produk baru. ' +
  'Fitur utama adalah kecepatan. Terima kasih banyak.';

describe('Tracker basic follow', () => {
  it('advances position as the transcript matches the script', () => {
    const t = new Tracker(SCRIPT);
    t.feed('selamat pagi semua', true);
    expect(t.position).toBeGreaterThanOrEqual(3);
  });

  it('AC-04.04: speech not in the script does not move position', () => {
    const t = new Tracker(SCRIPT);
    t.feed('selamat pagi semua', true);
    const p = t.position;
    t.feed('apa kabar teman-teman semuanya', true);
    expect(t.position).toBe(p);
  });

  it('AC-04.03: a skipped/misheard word still tracks', () => {
    const t = new Tracker(SCRIPT);
    // "hari ini kita membahas" spoken as "hari kita bahas produk" (skip + mishear)
    t.feed('selamat pagi semua hari kita bahas produk', true);
    expect(t.position).toBeGreaterThanOrEqual(7);
  });

  it('AC-04.03: English word written phonetically still matches', () => {
    const t = new Tracker('Kita pakai meeting hari ini');
    t.feed('kita pakai miting', true); // "meeting" -> "miting"
    expect(t.position).toBeGreaterThanOrEqual(3);
  });

  it('interim only advances, never retreats', () => {
    const t = new Tracker(SCRIPT);
    t.feed('selamat pagi semua hari ini kita membahas', true);
    const p = t.position;
    // Without the interim guard, this phrase's true alignment end is token 3
    // (a real retreat from p=7) -- so this assertion only holds BECAUSE the
    // interim-may-only-advance rule is enforced; disabling that guard makes
    // this test fail (verified manually: position becomes 3, not p).
    t.feed('selamat pagi', false); // interim pointing backwards
    expect(t.position).toBe(p);
  });

  it('AC-04.05: repeating the last sentence is still followed (exact retreat position)', () => {
    const t = new Tracker(SCRIPT);
    // Advance a bit past the end of sentence 2 ("...produk baru" ends at
    // token index 9), into sentence 3, so the upcoming repeat is a genuine
    // retreat and not just "stay where we already are".
    t.setPosition(12);
    // repeat sentence 2 as a final -> should land exactly at its end (idx 9),
    // a retreat of 3 tokens, within the allowed <=5 retreat.
    const p = t.feed('hari ini kita membahas produk baru', true);
    expect(p).toBe(9);
  });

  it('AC-04.05b: a final retreat of more than 5 tokens is refused', () => {
    const t = new Tracker(SCRIPT);
    // Place position far past the phrase we're about to repeat: "selamat
    // pagi semua" truly ends at token index 3, so retreating there from 15
    // would be a 12-token retreat -- well beyond the allowed 5. Per spec §4
    // step 2, the candidate window floor is pos-5, so a match at token 3 is
    // outside the window entirely (never considered) -- position must stay
    // put exactly, not merely "not jump to token 3".
    t.setPosition(15);
    const p = t.feed('selamat pagi semua', true);
    expect(p).toBe(15);
  });

  it('AC-04.05c: a final retreat of exactly 5 tokens is accepted', () => {
    const t = new Tracker(SCRIPT);
    // "hari ini kita membahas produk baru" truly ends at token index 9.
    // From pos=14 that is a retreat of exactly 5 tokens -- the boundary case
    // the pos-5 window floor must still include. The candidate loop must
    // start at `lo` itself (Math.max(1, lo)), not `lo + 1`: manually verified
    // that starting at `lo + 1` makes this test fail (position lands on 10
    // instead of 9, i.e. the pos-5 candidate is silently skipped).
    t.setPosition(14);
    const p = t.feed('hari ini kita membahas produk baru', true);
    expect(p).toBe(9);
  });

  it('AC-04.06: duplicate phrase does not jump to a far occurrence', () => {
    const dup = 'terima kasih semua. lalu kita mulai. terima kasih semua lagi.';
    const t = new Tracker(dup);
    t.feed('terima kasih semua', true); // matches the near (first) occurrence
    expect(t.position).toBeLessThanOrEqual(4);
  });

  it('matches purely via edit distance, with no exact or phonetic matches', () => {
    // Every heard word here differs from its script word (so no exact match),
    // and each pair's phonetic reduction also differs (so no phonetic match
    // either, verified: phonetic('kecepatan')='kesepatan' vs
    // phonetic('kecepetan')='kesepetan', etc.) -- only Levenshtein <= cap
    // (cap=2 for words > 5 chars) lets these three word-pairs score. Three
    // edit-distance matches (1 each) clear the score>=3 threshold together.
    // Manually verified this test fails (position stays 0) when the
    // Levenshtein branch in pairScore() is disabled.
    const t = new Tracker('kecepatan membahas perusahaan pekerjaan');
    const p = t.feed('kecepetan membahes perusahaen', true);
    expect(p).toBeGreaterThanOrEqual(3);
  });
});

describe('Tracker sentence boundaries with newlines', () => {
  it('a newline between lines starts a new sentence even with no punctuation', () => {
    const script = 'Baris satu tanpa titik\nBaris dua tanpa titik\nBaris tiga';
    const t = new Tracker(script);
    // tokens: 0 baris,1 satu,2 tanpa,3 titik | 4 baris,5 dua,6 tanpa,7 titik | 8 baris,9 tiga
    expect(t.sentenceStarts).toEqual([0, 4, 8]);
  });

  it('nextSentence walks newline-separated lines', () => {
    const script = 'Baris satu tanpa titik\nBaris dua tanpa titik\nBaris tiga';
    const t = new Tracker(script);
    expect(t.nextSentence()).toBe(4);
    expect(t.nextSentence()).toBe(8);
  });
});

describe('Tracker manual + pause + status', () => {
  it('nextSentence / prevSentence move by sentence', () => {
    const t = new Tracker(SCRIPT);
    const s1 = t.nextSentence();
    expect(s1).toBeGreaterThan(0);
    const back = t.prevSentence();
    expect(back).toBe(0);
  });

  it('setPosition sets an explicit position', () => {
    const t = new Tracker(SCRIPT);
    t.setPosition(5);
    expect(t.position).toBe(5);
  });

  it('no feed leaves position unchanged as time passes (pause)', () => {
    let clock = 1000;
    const t = new Tracker(SCRIPT, () => clock);
    t.setPosition(4);
    // Simulate a long pause: advance the injected clock a lot without ever
    // calling feed(). Nothing but feed()/setPosition() may move position, so
    // it must still read 4 no matter how much time passes while paused.
    clock += 60000;
    expect(t.position).toBe(4);
    clock += 5 * 60000;
    expect(t.position).toBe(4);
  });

  it('status becomes lost after 10s without a match', () => {
    let clock = 1000;
    const t = new Tracker(SCRIPT, () => clock);
    t.feed('selamat pagi semua', true);
    expect(t.status).toBe('ok');
    clock += 11000;
    t.feed('xyz qwe rty', true); // no match
    expect(t.status).toBe('lost');
  });
});

// Chrome's continuous recognition splits speech into separate results after
// short pauses, and each result is fed on its own — often a single word.
describe('Tracker with short speech segments', () => {
  const SHORT = 'Selamat pagi semuanya. Saat ini kami sedang mengembangkan fitur baru.';

  function atSaatIniKami(clock?: () => number) {
    const t = new Tracker(SHORT, clock);
    t.feed('selamat pagi semuanya', true);
    t.feed('saat ini kami', true);
    expect(t.position).toBe(6);
    return t;
  }

  it('a one-word final segment advances using the previous words as context', () => {
    const t = atSaatIniKami();
    t.feed('sedang', true);
    expect(t.position).toBe(7);
    t.feed('mengembangkan', true);
    expect(t.position).toBe(8);
  });

  it('a one-word interim segment advances too', () => {
    const t = atSaatIniKami();
    t.feed('sedang', false);
    expect(t.position).toBe(7);
  });

  it('context alone is not a match: off-script words still go lost', () => {
    let clock = 1000;
    const t = atSaatIniKami(() => clock);
    clock += 11000;
    t.feed('halo', true);
    expect(t.position).toBe(6);
    expect(t.status).toBe('lost');
  });

  it('a manual move drops the old context', () => {
    const t = atSaatIniKami();
    t.setPosition(0);
    t.feed('sedang', true); // alone, without "saat ini kami" before it
    expect(t.position).toBe(0);
  });

  it('setPosition to the same place (continue after pause) keeps the context', () => {
    const t = atSaatIniKami();
    t.setPosition(6);
    t.feed('sedang', true);
    expect(t.position).toBe(7);
  });
});

// Scripts with a chorus repeated back to back and many short common words:
// a couple of matching words must not pull the position into a later copy.
describe('Tracker with repeated passages', () => {
  // Synthetic song-like text (verse, then chorus + bridge three times, then
  // the last line twice more): short common words and back-to-back repeats.
  const VERSE = 'Pagi ini ku berjalan sendiri\nTak ramai seperti dulu\nKamu kok begitu melupakan aku\nBegitu jauh dari hatiku\n';
  const CHORUS = 'Biar ku tinggalkan saja\nKu tak mau hatiku terluka\nLebih baik ku lepaskan saja\nKu tak mau batinku tersiksa\n';
  const BRIDGE = 'Jangan kau selalu merasa\nDunia bukan milikmu saja\nLebih baik ku tinggalkan saja\nCari teman lagi\n';
  const S = VERSE + CHORUS + BRIDGE + CHORUS + BRIDGE + CHORUS + BRIDGE + 'Cari teman lagi\nCari teman lagi';
  // Feed sequences below were captured from a simulation of noisy speech
  // (misheard words, fillers, random segment sizes) that made the old
  // tracker jump 19-39 words ahead.

  it('noise plus "ku tak" does not jump into the chorus', () => {
    const t = new Tracker(S);
    t.feed('eh tersiksa ku', true); // filler + misheard words, reader at word 4
    t.feed('ku tak', false); // reader at "tak" (word 5)
    expect(t.position).toBeLessThanOrEqual(8);
  });

  it('a lone word after a noisy segment does not jump to a later chorus', () => {
    const t = new Tracker(S);
    t.setPosition(15);
    for (const [text, fin] of [
      ['ku', false], ['ku tinggalkan', false], ['ku tinggalkan', true], ['saja', false],
      ['saja tersiksa oke mau', false], ['saja tersiksa oke mau merasa biar', true],
    ] as const) t.feed(text, fin);
    const before = t.position; // reader is at word 27
    t.feed('lebih', false);
    expect(t.position - before).toBeLessThanOrEqual(8);
  });

  it('a misheard repeat of the last line does not skip to the final copy', () => {
    const t = new Tracker(S);
    t.setPosition(81);
    for (const [text, fin] of [
      ['lebih mau', true], ['ku', false], ['ku tinggalkan', false],
      ['ku tinggalkan saja', false], ['ku tinggalkan saja', true], ['cari', false],
    ] as const) t.feed(text, fin);
    t.feed('cari lagi lagi', false); // reader at word 87
    expect(t.position).toBeLessThanOrEqual(92);
  });

  // S word indices: chorus 1 = biar(18) ku tinggalkan saja | ku(22) tak mau
  // hatiku terluka(26) | lebih(27) baik(28) ku lepaskan saja(31) | ku(32) tak(33) ...

  it('a misheard word at the end of a growing interim does not jump ahead', () => {
    const t = new Tracker(S);
    t.setPosition(18);
    t.feed('biar ku tinggalkan saja', true);
    for (const text of ['ku', 'ku tak', 'ku tak mau']) t.feed(text, false);
    expect(t.position).toBe(25);
    t.feed('ku tak mau baik', false); // "hatiku" misheard as "baik" (word 28)
    expect(t.position).toBeLessThanOrEqual(26);
  });

  it('context plus one misheard word does not reach the next copy of that word', () => {
    const t = new Tracker(S);
    t.setPosition(18);
    t.feed('biar ku tinggalkan saja ku tak mau hatiku terluka', true);
    expect(t.position).toBe(27);
    t.feed('tak', false); // "lebih" misheard as "tak"; the next "tak" is word 33
    expect(t.position).toBeLessThanOrEqual(28);
  });

  it('after skipping unread lines, earlier context does not pull into a later copy', () => {
    // A block, then lines the reader skips, then B; A and B then repeat
    // without the junk in between, so earlier context fits the later copy.
    const A = 'Ku tak mau batinku tersiksa\n';
    const JUNK = 'Lagu lain\nBintang\nGrup Satu\nKu Tak Bisa\nGrup Dua\nPutri Iklan\nGrup Tiga\n';
    const B = 'Jangan kau selalu merasa\nDunia bukan milikmu saja\n';
    const t = new Tracker(A + JUNK + B + A + B);
    // ku(0) tak mau batinku tersiksa(4) | junk 5..18 | jangan(19) kau selalu
    // merasa | dunia(23) bukan milikmu(25) saja(26) | A again 27..31 | jangan(32) ...
    t.feed('ku tak mau batinku tersiksa', true);
    t.feed('tersiksa jangan kau', true);
    t.feed('merasa', false);
    t.feed('merasa dunia', false);
    t.feed('merasa dunia bukan', false);
    t.feed('merasa dunia bukan milikmu', false);
    expect(t.position).toBe(26);
  });

  it('context alone does not pull a final result back behind the position', () => {
    const A = 'Lebih baik kusudahi saja\nKu tak mau batinku tersiksa\n';
    const JUNK = 'Lagu lain\nBintang\nGrup Satu\nKu Tak Bisa\nGrup Dua\nPutri Iklan\nGrup Tiga\n';
    const B = 'Jangan kau selalu merasa\nDunia bukan milikmu saja\n';
    const t = new Tracker(A + JUNK + B);
    // lebih(0) baik kusudahi saja(3) | ku(4) tak mau batinku(7) tersiksa(8) | junk | jangan(23) ...
    t.feed('lebih baik kusudahi saja ku', true);
    for (const text of ['tak', 'tak mau', 'tak mau batinku']) t.feed(text, false);
    t.feed('tak mau batinku', true);
    const at = t.position;
    // the reader skipped "tersiksa" and the junk lines, and reads B
    t.feed('kau selalu merasa', true);
    expect(t.position).toBeGreaterThanOrEqual(at);
  });

  it('a long exact phrase can still move the position far ahead', () => {
    const t = new Tracker(S);
    t.setPosition(5);
    // the second chorus line, 17 words ahead, read in full with its neighbours
    t.feed('biar ku tinggalkan saja ku tak mau hatiku terluka', true);
    expect(t.tokens[t.position - 1].norm).toBe('terluka');
  });
});

// The speaker clicks a word (or uses the slider / prev / next) to skip ahead
// and starts reading there. The words before the new position count as said.
describe('Tracker after a manual move', () => {
  // selamat(0) pagi(1) semuanya(2) | hari(3) ini(4) kami(5) akan(6)
  // memperkenalkan(7) fitur(8) baru(9) untuk(10) tim(11) penjualan(12) |
  // fitur(13) ini(14) membantu(15) presentasi(16) menjadi(17) lebih(18) lancar(19)
  const S =
    'Selamat pagi semuanya. Hari ini kami akan memperkenalkan fitur baru untuk tim penjualan. ' +
    'Fitur ini membantu presentasi menjadi lebih lancar.';

  it('saying the clicked word moves on at once (one-word final)', () => {
    const t = new Tracker(S);
    t.setPosition(6); // clicked "akan"
    t.feed('akan', true);
    expect(t.position).toBe(7);
  });

  it('saying the clicked word moves on at once (one-word interim)', () => {
    const t = new Tracker(S);
    t.setPosition(6);
    t.feed('akan', false);
    expect(t.position).toBe(7);
  });

  it('after jumping to a sentence start, skipping its first 3 words still follows', () => {
    const t = new Tracker(S);
    t.setPosition(3); // e.g. prev-sentence to "Hari"
    t.feed('akan', true); // skipped "hari ini kami"
    expect(t.position).toBe(7);
  });

  it('an off-script word after a manual move does not move', () => {
    const t = new Tracker(S);
    t.setPosition(6);
    t.feed('halo', true);
    expect(t.position).toBe(6);
  });

  it('a lone word far ahead does not pull the position there', () => {
    const t = new Tracker(S);
    t.setPosition(3);
    t.feed('presentasi', true); // word 16, 13 words ahead
    expect(t.position).toBe(3);
  });
});
