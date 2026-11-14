import { expect, it } from 'vitest';
import { formatBytes } from './format-bytes';

it('keeps one decimal below 10 GB and rounds above', () => {
  expect(formatBytes(512)).toBe('512 B');
  expect(formatBytes(3 * 1024)).toBe('3 KB');
  expect(formatBytes(250 * 1024 ** 2)).toBe('250 MB');
  expect(formatBytes(1.25 * 1024 ** 3)).toBe('1.3 GB');
  expect(formatBytes(10_092_102_593)).toBe('9.4 GB');
  expect(formatBytes(12 * 1024 ** 3)).toBe('12 GB');
});
