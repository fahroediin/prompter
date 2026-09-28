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
    t.feed('selamat pagi', false); // interim pointing backwards
    expect(t.position).toBe(p);
  });

  it('AC-04.05: repeating the last sentence is still followed', () => {
    const t = new Tracker(SCRIPT);
    t.feed('selamat pagi semua hari ini kita membahas produk baru', true);
    const p = t.position;
    // repeat previous sentence as a final -> allowed small retreat
    t.feed('hari ini kita membahas produk baru', true);
    expect(t.position).toBeLessThanOrEqual(p);
    expect(t.position).toBeGreaterThan(0);
  });

  it('AC-04.06: duplicate phrase does not jump to a far occurrence', () => {
    const dup = 'terima kasih semua. lalu kita mulai. terima kasih semua lagi.';
    const t = new Tracker(dup);
    t.feed('terima kasih semua', true); // matches the near (first) occurrence
    expect(t.position).toBeLessThanOrEqual(4);
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

  it('no feed leaves position unchanged (pause)', () => {
    const t = new Tracker(SCRIPT);
    t.setPosition(4);
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
