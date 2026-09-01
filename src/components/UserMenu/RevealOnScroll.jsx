import { useEffect, useRef, useState } from "react";

// ─── Scroll-triggered reveal ───────────────────────────────────────────────────
// Every section below the hero already carries cc-fade-in-up (+ a per-card animationDelay
// stagger), but as a plain CSS animation it plays once on MOUNT — meaning anything below the
// fold has already finished animating before the user scrolls anywhere near it, so the entrance
// effect was invisible for most of the page. This wraps a section, holds its cc-fade-in-up
// children paused at their opacity:0 frame (via .cc-reveal-group's animation-play-state, see the
// <style> block below) until an IntersectionObserver confirms it's actually in view, then lets
// the existing animation play. No changes needed to any of the individual card/section JSX.
// `Tag` is used as a dynamic JSX element below; the base no-unused-vars rule doesn't recognize
// that without eslint-plugin-react's jsx-uses-vars, hence the disable directive right below.
// eslint-disable-next-line no-unused-vars
export default function RevealOnScroll({ children, className = "", as: Tag = "div", ...rest }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -80px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag ref={ref} className={`cc-reveal-group ${visible ? "is-visible" : ""} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}
