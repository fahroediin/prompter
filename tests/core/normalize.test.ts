import { describe, it, expect } from 'vitest';
import { normalize, phonetic } from '../../src/core/normalize';

describe('phonetic', () => {
  it('maps ph to f', () => expect(phonetic('phone')).toBe('fone'));
  it('maps ee to i and oo to u', () => {
    expect(phonetic('meeting')).toBe('miting');
    expect(phonetic('food')).toBe('fud');
  });
  it('c before e/i/y becomes s, else k', () => {
    expect(phonetic('city')).toBe('siti');
    expect(phonetic('cat')).toBe('kat');
  });
  it('y becomes i', () => expect(phonetic('yes')).toBe('ies'));
  it('collapses doubled consonants', () => expect(phonetic('happy')).toBe('hapi'));
  it('drops trailing h', () => expect(phonetic('rumah')).toBe('ruma'));
});

describe('normalize', () => {
  it('lowercases, strips punctuation, drops empties', () => {
    const toks = normalize('Hello, World!');
    expect(toks.map((t) => t.raw)).toEqual(['Hello', 'World']);
    expect(toks.map((t) => t.norm)).toEqual(['hello', 'world']);
  });
  it('produces phon key per token', () => {
    const toks = normalize('Phone city');
    expect(toks.map((t) => t.phon)).toEqual(['fone', 'siti']);
  });
});
