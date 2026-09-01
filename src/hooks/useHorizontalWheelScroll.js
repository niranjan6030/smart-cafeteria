import { useEffect } from "react";

// ─── useHorizontalWheelScroll ────────────────────────────────────────────────
// Lets a mouse wheel move a horizontal carousel: while the pointer is over a
// scrollable row, vertical wheel delta is translated into horizontal scrolling.
// The page's normal vertical scroll is only taken over while the row can still
// move in that direction — at either end the event is left alone so the page
// scrolls. React's synthetic wheel handler is passive at the root, so this uses
// a native, non-passive listener to allow preventDefault (which is what makes
// the takeover work on desktop).
export function useHorizontalWheelScroll(ref) {
  useEffect(() => {
    const el = ref?.current;
    if (!el) return undefined;

    const onWheel = (event) => {
      if (!event.deltaY) return;
      if (el.scrollWidth <= el.clientWidth) return;

      const maxLeft = el.scrollWidth - el.clientWidth;
      const atStart = el.scrollLeft <= 0 && event.deltaY < 0;
      const atEnd = el.scrollLeft >= maxLeft && event.deltaY > 0;
      if (atStart || atEnd) return;

      event.preventDefault();
      el.scrollLeft += event.deltaY;
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref]);
}
