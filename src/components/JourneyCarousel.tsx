"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, BellRing, ChevronLeft, ChevronRight, Pause, Play, Route, Search } from "lucide-react";

const slides = [
  { title: "Every journey.\nA little clearer.", body: "Find your truck’s recorded toll crossings.", action: "Find a truck", href: "/portal/search", icon: Search, image: true, tone: "road" },
  { title: "Your trucks.\nCloser at hand.", body: "Save a truck and follow its crossing history.", action: "View my trucks", href: "/portal/trucks", icon: Route, image: false, tone: "fleet" },
  { title: "On the move?\nBe in the know.", body: "Set up alerts for newly recorded crossings.", action: "Set up alerts", href: "/portal/settings#alerts", icon: BellRing, image: false, tone: "alerts" },
];

/** Native scroll-snap supports touch, trackpads and keyboard without a motion library. */
export function JourneyCarousel() {
  const rail = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [interacting, setInteracting] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => { if (preference.matches) setPlaying(false); };
    sync();
    preference.addEventListener("change", sync);
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: .35 });
    if (rail.current) observer.observe(rail.current);
    return () => { preference.removeEventListener("change", sync); observer.disconnect(); };
  }, []);
  useEffect(() => {
    if (!playing || interacting || hovering || focused || !inView) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) go((current + 1) % slides.length);
    }, 5500);
    return () => window.clearInterval(timer);
  }, [playing, interacting, hovering, focused, inView, current]);
  function go(index: number) {
    const el = rail.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: (el.children[index] as HTMLElement).offsetLeft - (el.children[0] as HTMLElement).offsetLeft, behavior: reduced ? "instant" : "smooth" });
  }
  return <section className="journey-carousel" aria-label="Explore truck tracking" aria-roledescription="carousel"
    onPointerEnter={event => { if (event.pointerType === "mouse") setHovering(true); }} onPointerLeave={() => { setHovering(false); setInteracting(false); }}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    onPointerDown={() => setInteracting(true)} onPointerUp={() => setInteracting(false)} onPointerCancel={() => setInteracting(false)}>
    <div className="journey-rail" ref={rail} onScroll={() => {
      const el = rail.current;
      if (el) setCurrent(Math.round(el.scrollLeft / (el.clientWidth + 12)));
    }}>
      {slides.map((slide, index) => <article className={`journey-slide journey-${slide.tone}`} key={slide.tone} aria-label={`${index + 1} of ${slides.length}`} aria-roledescription="slide">
        {slide.image ? <img className="journey-road-photo" src="/home-highway-truck.webp" alt="A container truck on a mountain highway" width={1536} height={1024} fetchPriority="high" /> : <div className="journey-sculpture" aria-hidden="true"><div className="journey-orbit" /><div className="journey-icon-block"><slide.icon size={64} strokeWidth={1.4} /></div><span className="journey-mini-block"><slide.icon size={23} /></span></div>}
        <div className="journey-slide-copy"><span className="journey-tag"><slide.icon size={13} />{index === 0 ? "Made for the road" : index === 1 ? "Your fleet, organised" : "Updates that matter"}</span><h2>{slide.title}</h2><p>{slide.body}</p><Link href={slide.href} className="app-primary">{slide.action}<ArrowRight size={17} /></Link></div>
      </article>)}
    </div>
    <div className="journey-controls"><div className="journey-dots" aria-label="Choose a slide">{slides.map((slide, index) => <button type="button" key={slide.tone} aria-label={`Show slide ${index + 1}: ${slide.action}`} aria-pressed={index === current} onClick={() => go(index)} />)}</div><span className="journey-swipe-hint">Swipe to explore</span><div className="journey-arrows"><button type="button" aria-label={playing ? "Pause slideshow" : "Play slideshow"} onClick={() => setPlaying(value => !value)}>{playing ? <Pause size={14} /> : <Play size={14} />}</button><button type="button" aria-label="Previous slide" onClick={() => go((current + slides.length - 1) % slides.length)}><ChevronLeft size={18} /></button><button type="button" aria-label="Next slide" onClick={() => go((current + 1) % slides.length)}><ChevronRight size={18} /></button></div></div>
  </section>;
}
