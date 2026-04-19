export const MOBILE_LAYOUT_MAX_WIDTH = 767;

export interface MobileLayoutSignals {
  isCompactViewport: boolean;
  hasCoarsePointer: boolean;
  hasHover: boolean;
}

export function shouldUseMobileLayout({
  isCompactViewport,
  hasCoarsePointer,
  hasHover,
}: MobileLayoutSignals): boolean {
  return isCompactViewport && (hasCoarsePointer || !hasHover);
}
