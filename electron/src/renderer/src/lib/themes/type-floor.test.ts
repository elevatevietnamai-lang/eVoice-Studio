import { describe, expect, it } from 'vitest';

/**
 * DESIGN.md's smallest role is the 12 px caption; dense labels (badges, timeline ticks, chips) may go
 * to 11 px, never below. Text under 11 px fails the impeccable detector's legibility floor and
 * was scattered across ~50 call sites before this guard.
 */
const sources = import.meta.glob(
  ['../../**/*.{tsx,ts,css}', '!../../**/*.test.{tsx,ts}', '!../../lib/opencut/vendor/**'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const SIZE = /text-\[(\d+(?:\.\d+)?)(px|rem)\]|font-size:\s*(\d+(?:\.\d+)?)(px|rem)/g;
const FLOOR_PX = 11;

describe('type floor', () => {
  it('scans the renderer sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100);
  });

  it('never sets UI text below 11 px', () => {
    const hits: string[] = [];
    for (const [file, source] of Object.entries(sources)) {
      source.split(/\r?\n/).forEach((line, index) => {
        for (const match of line.matchAll(SIZE)) {
          const value = Number(match[1] ?? match[3]);
          const px = (match[2] ?? match[4]) === 'rem' ? value * 16 : value;
          if (px < FLOOR_PX) hits.push(`${file}:${index + 1} ${match[0]}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });
});
