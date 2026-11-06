export function HomeHero({
  greeting,
  title,
  highlight,
  body,
}: {
  greeting: string | null;
  title: string;
  highlight: string | null;
  body: string;
}) {
  return (
    <section className="home-hero" data-reveal>
      <div aria-hidden className="home-hero-art">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/home-highway-truck.webp" alt="" width={1536} height={1024} fetchPriority="high" />
      </div>
      <div className="home-hero-copy">
        {greeting ? <p className="home-hero-greeting">{greeting}</p> : null}
        <h1>
          {title}
          {highlight ? <><br /><span className="home-hero-highlight">{highlight}</span></> : null}
        </h1>
        <p className="home-hero-body">{body}</p>
      </div>
    </section>
  );
}
