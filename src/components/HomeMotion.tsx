"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Progressive enhancement: content stays visible when animation is unavailable. */
export function HomeMotion({ children, className }: { children: ReactNode; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = root.current;
    if (!container || !('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const items = Array.from(container.querySelectorAll<HTMLElement>('[data-reveal]'));
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          (entry.target as HTMLElement).dataset.reveal = 'visible';
          observer.unobserve(entry.target);
        }
      }
    }, { threshold: 0.08 });
    items.forEach(item => { item.dataset.reveal = 'waiting'; observer.observe(item); });
    return () => { observer.disconnect(); items.forEach(item => { delete item.dataset.reveal; }); };
  }, []);
  return <div ref={root} className={className} onClick={event => {
    const link = (event.target as HTMLElement).closest?.('.landing-mobile-menu a');
    link?.closest('details')?.removeAttribute('open');
  }}>{children}</div>;
}
