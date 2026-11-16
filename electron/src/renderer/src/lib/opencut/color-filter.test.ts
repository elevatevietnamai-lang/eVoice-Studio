import { describe, expect, it } from 'vitest';
import { colorFilterFor } from './color-filter';

describe('colour looks', () => {
  it('maps a preset and the sliders to one canvas filter', () => {
    expect(colorFilterFor({})).toBe('');
    expect(colorFilterFor({ 'filter.preset': 'mono' })).toBe('grayscale(1) contrast(1.08)');
    expect(colorFilterFor({ 'filter.preset': 'none', 'filter.brightness': 1.2, 'filter.saturation': 0 })).toBe(
      'brightness(1.2) saturate(0)',
    );
    // Neutral sliders add nothing; an unknown preset is ignored.
    expect(colorFilterFor({ 'filter.preset': 'neon', 'filter.contrast': 1 })).toBe('');
  });
});
