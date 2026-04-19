import { useEffect, useState } from 'react';

import { MOBILE_LAYOUT_MAX_WIDTH, shouldUseMobileLayout } from '@/lib/responsive';

const COMPACT_VIEWPORT_QUERY = `(max-width: ${String(MOBILE_LAYOUT_MAX_WIDTH)}px)`;
const COARSE_POINTER_QUERY = '(pointer: coarse)';
const HOVER_QUERY = '(hover: hover)';

function getIsMobile(): boolean {
  if (typeof window === 'undefined') return false;

  return shouldUseMobileLayout({
    isCompactViewport: window.matchMedia(COMPACT_VIEWPORT_QUERY).matches,
    hasCoarsePointer: window.matchMedia(COARSE_POINTER_QUERY).matches,
    hasHover: window.matchMedia(HOVER_QUERY).matches,
  });
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(getIsMobile);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const compactViewportQuery = window.matchMedia(COMPACT_VIEWPORT_QUERY);
    const coarsePointerQuery = window.matchMedia(COARSE_POINTER_QUERY);
    const hoverQuery = window.matchMedia(HOVER_QUERY);
    const update = (): void => {
      setIsMobile(
        shouldUseMobileLayout({
          isCompactViewport: compactViewportQuery.matches,
          hasCoarsePointer: coarsePointerQuery.matches,
          hasHover: hoverQuery.matches,
        })
      );
    };

    update();
    compactViewportQuery.addEventListener('change', update);
    coarsePointerQuery.addEventListener('change', update);
    hoverQuery.addEventListener('change', update);

    return (): void => {
      compactViewportQuery.removeEventListener('change', update);
      coarsePointerQuery.removeEventListener('change', update);
      hoverQuery.removeEventListener('change', update);
    };
  }, []);

  return isMobile;
}
