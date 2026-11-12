import { describe, expect, it } from 'vitest';
import { chromaKeyFor, chromaKeyId, hexToRgb, keyPixel, type ChromaKey } from './chroma-key';

const green: ChromaKey = { color: [0, 1, 0], threshold: 0.25, softness: 0.1, spill: 0.5 };

describe('chroma key', () => {
  it('is off unless the element turns it on, with green as the default colour', () => {
    expect(chromaKeyFor({})).toBeNull();
    expect(chromaKeyFor({ 'chroma.enabled': true })).toEqual({ color: [0, 1, 0], threshold: 0.25, softness: 0.1, spill: 0.5 });
    expect(chromaKeyFor({ 'chroma.enabled': true, 'chroma.color': '#0000ff', 'chroma.threshold': 3 })).toMatchObject({
      color: [0, 0, 1],
      threshold: 1,
    });
    expect(hexToRgb('#ff8000')).toEqual([1, 128 / 255, 0]);
  });

  it('clears the key colour and keeps colours far from it', () => {
    expect(keyPixel(0, 1, 0, green)[3]).toBe(0);
    // A slightly different green is still keyed out.
    expect(keyPixel(0.1, 0.9, 0.12, green)[3]).toBe(0);
    expect(keyPixel(1, 0, 1, green)[3]).toBe(1);
    expect(keyPixel(0.9, 0.7, 0.6, green)[3]).toBe(1);
  });

  it('has a soft edge between the threshold and threshold plus softness', () => {
    const key = { ...green, threshold: 0.1, softness: 0.8 };
    const alpha = keyPixel(0.4, 0.8, 0.4, key)[3];
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(1);
  });

  it('takes the key tint out of what stays', () => {
    // A face lit by a green screen: green stands above red.
    const [r, g, b] = keyPixel(0.6, 0.8, 0.5, green);
    expect(g).toBeCloseTo(0.7);
    expect([r, b]).toEqual([0.6, 0.5]);
    expect(keyPixel(0.6, 0.8, 0.5, { ...green, spill: 0 })[1]).toBe(0.8);
    // A blue key leaves green alone and limits blue.
    expect(keyPixel(0.2, 0.3, 0.9, { ...green, color: [0, 0, 1], spill: 1 })[2]).toBeCloseTo(0.3);
  });

  it('names a key for texture revisions, so a changed key redraws', () => {
    expect(chromaKeyId(null)).toBe('');
    expect(chromaKeyId(green)).not.toBe(chromaKeyId({ ...green, threshold: 0.3 }));
  });
});
