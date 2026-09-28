export type Token = { raw: string; norm: string; phon: string };

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

export function phonetic(word: string): string {
  let w = word.toLowerCase();
  w = w.replace(/ph/g, 'f');
  // c -> s before e/i/y, else k
  w = w.replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k');
  w = w.replace(/y/g, 'i');
  w = w.replace(/ee/g, 'i').replace(/oo/g, 'u');
  // collapse doubled consonants (not vowels)
  w = w.replace(/([^aeiou])\1+/g, '$1');
  // drop trailing h
  w = w.replace(/h$/, '');
  return w;
}

export function normalize(text: string): Token[] {
  const out: Token[] = [];
  for (const raw of text.split(/\s+/)) {
    const stripped = raw.replace(/[^\p{L}\p{N}]/gu, '');
    if (!stripped) continue;
    const norm = stripped.toLowerCase();
    out.push({ raw: stripped, norm, phon: phonetic(norm) });
  }
  return out;
}
