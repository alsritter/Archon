import { describe, expect, test } from 'bun:test';

import { MOBILE_LAYOUT_MAX_WIDTH, shouldUseMobileLayout } from './responsive';

describe('responsive', () => {
  test('uses the shared compact viewport breakpoint', () => {
    expect(MOBILE_LAYOUT_MAX_WIDTH).toBe(767);
  });

  test('enables mobile layout for compact touch devices', () => {
    expect(
      shouldUseMobileLayout({
        isCompactViewport: true,
        hasCoarsePointer: true,
        hasHover: false,
      })
    ).toBe(true);
  });

  test('disables mobile layout for compact desktop-style devices', () => {
    expect(
      shouldUseMobileLayout({
        isCompactViewport: true,
        hasCoarsePointer: false,
        hasHover: true,
      })
    ).toBe(false);
  });

  test('disables mobile layout for large touch-capable screens', () => {
    expect(
      shouldUseMobileLayout({
        isCompactViewport: false,
        hasCoarsePointer: true,
        hasHover: false,
      })
    ).toBe(false);
  });
});
