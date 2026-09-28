import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { projects, projectIndex, projectUrl, site } from '../content/projects';
import { useTransition } from '../app/Transition';
import { session } from '../app/session';
import { gsap, ScrollTrigger, SplitText, EASE, prefersReducedMotion } from '../motion/tokens';
import { ScrollNext } from '../motion/ScrollNext';
import { HoverText } from '../components/HoverText';
import { GameEmbed } from '../components/GameEmbed';
import { ui, fill } from '../content/ui';

/**
 * `((text))` in copy is a muttered aside: rendered small and blurred, without the
 * brackets. Lazy match + lookahead so a closing smiley like `:)))` stays inside.
 * `rest` formats the plain parts in between (the lede uses it for `(…)` asides).
 */
function whispers(text: string, rest: (t: string, key: string) => ReactNode = (t) => t): ReactNode[] {
  return text.split(/\(\((.+?)\)\)(?!\))/).map((part, i) =>
    i % 2 ? <span key={i} className="whisper">{part}</span> : rest(part, String(i)),
  );
}

/** Split a title into ≤2 balanced word groups for the scroll-next rules. */
function wordGroups(title: string) {
  const w = title.toUpperCase().split(/\s+/);
  if (w.length < 2) return [w.join(' ')];
  const mid = Math.ceil(w.length / 2);
  return [w.slice(0, mid).join(' '), w.slice(mid).join(' ')];
}

type Block = { kind: 'p' | 'h'; text: string } | { kind: 'list' | 'ask'; items: string[] };
type Section = { title: string | null; blocks: Block[] };

/**
 * Lay a description out as lede + body + rail.
 * Blocks split on blank lines; "## X" is a heading, all-"- " lines are a list,
 * all-"> " lines are pull questions.
 * A heading directly followed by a list (e.g. Highlights) moves to the side rail.
 * With 2+ paragraphs, the opening paragraph becomes the lede.
 * Headings left in the body split it into titled sections.
 */
function layoutDescription(description: string) {
  const blocks: Block[] = description.split(/\n{2,}/).map((para) => {
    if (para.startsWith('## ')) return { kind: 'h', text: para.slice(3) };
    const lines = para.split('\n');
    if (lines.every((l) => l.startsWith('- '))) return { kind: 'list', items: lines.map((l) => l.slice(2)) };
    if (lines.every((l) => l.startsWith('> '))) return { kind: 'ask', items: lines.map((l) => l.slice(2)) };
    return { kind: 'p', text: para };
  });
  let rail: { title: string; items: string[] } | null = null;
  const at = blocks.findIndex((b, i) => b.kind === 'h' && blocks[i + 1]?.kind === 'list');
  if (at >= 0) {
    const [h, l] = blocks.splice(at, 2);
    rail = { title: (h as { text: string }).text, items: (l as { items: string[] }).items };
  }
  // A heading right before the opening paragraph labels the lede (small kicker above it).
  const kicker = blocks[0]?.kind === 'h' && blocks[1]?.kind === 'p' ? (blocks.shift() as { text: string }).text : null;
  const paras = blocks.filter((b) => b.kind === 'p').length;
  const lede = paras >= 2 && blocks[0]?.kind === 'p' ? (blocks.shift() as { text: string }).text : null;
  // Titled sections: each "## X" opens one; anything before the first is an untitled intro.
  let sections: Section[] | null = null;
  if (blocks.some((b) => b.kind === 'h')) {
    sections = [];
    for (const b of blocks) {
      if (b.kind === 'h') sections.push({ title: b.text, blocks: [] });
      else if (sections.length) sections[sections.length - 1].blocks.push(b);
      else sections.push({ title: null, blocks: [b] });
    }
  }
  return { kicker, lede, body: blocks, sections, rail };
}

/** One body block (paragraph, list or pull questions) inside a section. */
function sectionBlock(b: Block, i: number) {
  if (b.kind === 'list') return <ul key={i} className="about__bullets">{b.items.map((t, j) => <li key={j}>{whispers(t)}</li>)}</ul>;
  if (b.kind === 'ask') {
    return (
      <ul key={i} className="about__ask">
        {b.items.map((t, j) => <li key={j}><span className="rule" /><p>{t}</p></li>)}
      </ul>
    );
  }
  return <p key={i}>{whispers((b as { text: string }).text)}</p>;
}

export function DetailPage() {
  const { slug = '' } = useParams();
  const index = Math.max(0, projectIndex(slug));
  const p = projects[index];
  const next = projects[(index + 1) % projects.length];
  const { go } = useTransition();
  const mainRef = useRef<HTMLElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const aboutRef = useRef<HTMLElement>(null);
  const nextRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // Returning to the gallery lands on the project just viewed; no first-visit intro after this.
    session.galleryIndex = index;
    session.introDone = true;
    document.documentElement.removeAttribute('data-preload');
  }, [index]);

  // Hero entrance + description reveals.
  useEffect(() => {
    const reduced = prefersReducedMotion();
    const main = mainRef.current!, heroEl = heroRef.current!, about = aboutRef.current!;
    const splits: SplitText[] = [];
    const ctx = gsap.context(() => {
      gsap.set(main, { autoAlpha: 1 });
      if (!reduced) {
        const title = heroEl.querySelector('.hero__title')!;
        const st = new SplitText(title, { type: 'lines', mask: 'lines', linesClass: 'rv-line' });
        splits.push(st);
        const items = heroEl.querySelectorAll('[data-rv]');
        const rules = heroEl.querySelectorAll('.rule');
        const buttons = heroEl.querySelectorAll('.btn');
        const corners = heroEl.querySelectorAll('.hero__corner');
        gsap.set(st.lines, { yPercent: 120 });
        gsap.set(items, { yPercent: 120 });
        gsap.set(rules, { scaleX: 0, transformOrigin: 'left center' });
        if (buttons.length) gsap.set(buttons, { scale: 0.6, autoAlpha: 0 });
        gsap.set(corners, { scale: 0 });
        const tl = gsap.timeline({ delay: session.arrival === 'load' ? 0.1 : 0.05 });
        tl.fromTo(main, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6, ease: 'main' }, 0);
        tl.to(st.lines, { yPercent: 0, duration: 0.7, ease: EASE.glide, stagger: 0.08 }, 0.05);
        tl.to(rules, { scaleX: 1, duration: 0.9, ease: EASE.glide, stagger: 0.06 }, 0.08);
        tl.to(items, { yPercent: 0, duration: 0.7, ease: EASE.glide, stagger: 0.03 }, 0.12);
        if (buttons.length) tl.to(buttons, { scale: 1, autoAlpha: 1, duration: 0.5, ease: 'back.out(2.2)', stagger: 0.09 }, 0.38);
        tl.to(corners, { scale: 1, duration: 0.5, ease: EASE.glide, stagger: 0.05 }, 0.3);

        // Description: paragraph lines rise as they enter.
        // Split each paragraph/subheading on its own; splitting the container
        // flattens them into one run of lines and loses paragraph gaps and headings.
        // Lists are split per item for the same reason.
        about.querySelectorAll<HTMLElement>('.about__detour-label, .about__detour-body > p, .about__kicker, .about__lede, .about__text > :not(ul), .about__text > .about__bullets > li, .about__sec-title, .about__sec-body > p, .about__sec-body > .about__bullets > li, .about__rail-head > *, .about__list li > p, .about__credit-line, .about__coda').forEach((el) => {
          const s = new SplitText(el, { type: 'lines', mask: 'lines', linesClass: 'rv-line' });
          splits.push(s);
          gsap.from(s.lines, { yPercent: 120, duration: 0.7, ease: EASE.glide, stagger: 0.05, scrollTrigger: { trigger: el, start: 'top 90%' } });
        });
        // Pull questions rise whole (their row clips them), never split: splitting freezes
        // the line breaks, and a split made before the serif loaded kept the fallback
        // font's wider wrap, breaking questions that fit on one line.
        about.querySelectorAll<HTMLElement>('.about__ask li > p').forEach((el) => {
          // 170%: the row's bottom padding is inside the clip, so 120 would start half-visible.
          gsap.from(el, { yPercent: 170, duration: 0.7, ease: EASE.glide, scrollTrigger: { trigger: el, start: 'top 90%' } });
        });
        gsap.from(about.querySelectorAll('.about__head [data-tt-mask] > *'), { yPercent: 120, duration: 0.7, ease: EASE.glide, stagger: 0.035, scrollTrigger: { trigger: about, start: 'top 85%' } });
        // Rules draw in left to right as their row arrives.
        about.querySelectorAll<HTMLElement>('.rule').forEach((r) => {
          gsap.from(r, { scaleX: 0, transformOrigin: 'left center', duration: 0.9, ease: EASE.glide, scrollTrigger: { trigger: r, start: 'top 92%' } });
        });
      }
    }, main);
    requestAnimationFrame(() => ScrollTrigger.refresh());
    return () => {
      ctx.revert();
      splits.forEach((s) => s.revert());
    };
  }, [slug]);

  // Scroll-next controller.
  useEffect(() => {
    const section = nextRef.current!;
    const q = <T extends Element>(s: string) => Array.from(section.querySelectorAll<T & HTMLElement>(s)) as (T & HTMLElement)[];
    const ctrl = new ScrollNext({
      section,
      frame: section.querySelector('.next__frame')!,
      stage: section.querySelector('.next__stage')!,
      svg: section.querySelector('.next__svg')!,
      rules: q('.next__rule'),
      words: q('.next__word'),
      copy: q('[data-next-copy]'),
      hint: section.querySelector('.next__hint')!,
    }, next, prefersReducedMotion(), () => go(projectUrl(next), 'from-next'));
    // Boot the WebGL scene only when it's needed (near the viewport) or when the page is idle,
    // so context setup and shader warm-up never overlap the hero entrance.
    let booted = false;
    const boot = () => { if (!booted) { booted = true; io.disconnect(); clearTimeout(timer); ctrl.init(); } };
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && boot(), { rootMargin: '150% 0px' });
    io.observe(section);
    const timer = window.setTimeout(() => ('requestIdleCallback' in window ? requestIdleCallback(boot, { timeout: 4000 }) : boot()), 2500);
    return () => { booted = true; io.disconnect(); clearTimeout(timer); ctrl.dispose(); };
  }, [slug, next, go]);

  const desc = layoutDescription(p.description);
  const groups = wordGroups(next.title);
  const ruleTops = [14.7, 38.8, 63, 87.1];

  return (
    <main ref={mainRef} className="detail" style={{ visibility: 'hidden' }}>
      <section ref={heroRef} className="hero" aria-labelledby="project-title">
        <span className="hero__corner" style={{ left: '0.5em', bottom: '4svh' }} aria-hidden="true" />
        <span className="hero__corner" style={{ right: '0.5em', bottom: '4svh' }} aria-hidden="true" />
        <h1 id="project-title" className="hero__title display-xl fit" style={{ ['--chars' as string]: p.title.length }}>{p.title}</h1>
        <div className="hero__sub" data-tt-mask="">
          <p className="body-s" data-rv=""><span className="eyebrow">{p.category}</span>&nbsp;&nbsp;{p.year}</p>
        </div>
        <div className="hero__rules"><span className="rule" /></div>
        <div className="hero__table">
          {p.metadata.map((m) => (
            <div className="hero__row" key={m.label}>
              <span className="rule" />
              <div data-tt-mask=""><p className="eyebrow" data-rv="">{m.label}</p></div>
              <div data-tt-mask="" className="v"><p className="body-s" data-rv="">{Array.isArray(m.value) ? m.value.join(', ') : m.value}</p></div>
            </div>
          ))}
        </div>
        {p.links?.length ? (
          <div className="hero__cta">
            {p.links.map((l) => (
              <a
                key={l.label}
                className="btn"
                href={l.href}
                data-hover=""
                target={l.href.startsWith('http') ? '_blank' : undefined}
                rel="noopener noreferrer"
                // In-app routes go through the page transition instead of a full reload.
                onClick={l.href.startsWith('/') ? (e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); go(l.href, 'from-detail'); } : undefined}
              >
                <HoverText text={l.label} />
              </a>
            ))}
          </div>
        ) : null}
      </section>

      <section ref={aboutRef} className="about" aria-label={fill(ui.detail.sectionLabel, { title: p.title })}>
        <div className="about__head">
          <span className="rule" />
          <div data-tt-mask=""><p className="eyebrow">{p.category}</p></div>
          <div data-tt-mask=""><p className="body-s">{p.title}, {p.year}</p></div>
        </div>
        <div className="about__grid" data-game={p.game ? '' : undefined}>
          {p.detour || desc.kicker || desc.lede ? (
            // One grid cell for detour + kicker + lede, so the rail's row span is unchanged.
            <div className="about__open">
              {p.detour ? (
                // A side story told before the main one: small, muted, ruled off.
                <aside className="about__detour" aria-label={p.detour.label}>
                  <span className="rule" />
                  <p className="about__detour-label eyebrow">{p.detour.label}</p>
                  <div className="about__detour-body">
                    {p.detour.paragraphs.map((t, i) => <p key={i} className="body-s">{t}</p>)}
                  </div>
                  <span className="rule about__detour-end" />
                </aside>
              ) : null}
              {desc.kicker ? <h2 className="about__kicker eyebrow">{desc.kicker}</h2> : null}
              {desc.lede ? (
                <p className="about__lede">
                  {/* Parenthetical asides in the lede are set smaller and softer than the sentence. */}
                  {whispers(desc.lede, (t, k) => (
                    <Fragment key={k}>
                      {t.split(/(\([^)]*\))/).map((part, i) =>
                        i % 2 ? <span key={i} className="about__aside">{part}</span> : part,
                      )}
                    </Fragment>
                  ))}
                </p>
              ) : null}
            </div>
          ) : null}
          {/* Highlights sit before the body in source order: on stacked (mobile) layouts
              the skim layer comes first; on desktop the grid places it in the right rail. */}
          {p.game ? (
            // A playable game takes the rail slot instead of Highlights.
            // No label = no heading: the window then starts level with the lede.
            <aside className="about__rail about__rail--game" aria-label={p.game.label || p.game.title}>
              {p.game.label ? <div className="about__rail-head"><h2 className="eyebrow">{p.game.label}</h2></div> : null}
              <GameEmbed game={p.game} bg={p.palette.base} />
            </aside>
          ) : desc.rail ? (
            <aside className="about__rail">
              <div className="about__rail-head"><h2 className="eyebrow">{desc.rail.title}</h2></div>
              <ul className="about__list">
                {desc.rail.items.map((t, j) => {
                  // "Group: a · b" rows get a small group label above the values.
                  const g = /^([\w&/ ]{1,20}): (.+)$/.exec(t);
                  return (
                    <li key={j}>
                      <span className="rule" />
                      {g ? <p className="about__list-label eyebrow">{g[1]}</p> : null}
                      <p>{whispers(g ? g[2] : t)}</p>
                    </li>
                  );
                })}
              </ul>
            </aside>
          ) : null}
          {desc.sections ? (
            // Titled sections: a ruled row each, the title beside (or above) its text.
            <div className="about__sections">
              {desc.sections.map((s, i) => (
                <section key={i} className="about__sec" data-untitled={s.title ? undefined : ''}>
                  <span className="rule" />
                  {s.title ? <h2 className="about__sec-title">{s.title}</h2> : null}
                  <div className="about__sec-body body-m">{s.blocks.map(sectionBlock)}</div>
                </section>
              ))}
            </div>
          ) : desc.body.length ? (
            <div className="about__text body-m" data-cols={desc.body.length > 1 ? '' : undefined}>
              {desc.body.map((b, i) => (b.kind === 'h' ? <h2 key={i} className="about__subhead eyebrow">{b.text}</h2> : sectionBlock(b, i)))}
            </div>
          ) : null}
          {p.credit ? (
            // Muted credit after the story: "Label: Name" (linked), note underneath.
            <p className="about__credit body-s">
              <span className="rule" />
              <span className="about__credit-line">
                {p.credit.label}:{' '}
                {p.credit.href ? (
                  <a href={p.credit.href} target="_blank" rel="noopener noreferrer">{p.credit.name}</a>
                ) : p.credit.name}
              </span>
              {p.credit.note ? <span className="about__credit-line">{p.credit.note}</span> : null}
            </p>
          ) : null}
          {p.coda?.length ? (
            <p className="about__coda" data-solo={desc.rail ? undefined : ''}>
              {p.coda.map((line, i) => <span key={i}>{line}</span>)}
            </p>
          ) : null}
        </div>
        {p.previews?.length ? (
          <div className="sites">
            <div className="sites__head"><span className="rule" /><h2 className="eyebrow">{p.previews.length > 1 ? ui.detail.websiteMany : ui.detail.websiteOne}</h2></div>
            <ul className="sites__grid" data-count={p.previews.length}>
              {p.previews.map((s) => {
                const host = new URL(s.href).host.replace(/^www\./, '');
                return (
                  <li key={s.href}>
                    {/* Night: the screen lights the desk behind the window (CSS .screen-glow). */}
                    <span className="screen-glow" aria-hidden="true" style={{ ['--glow-bg' as string]: `url(${JSON.stringify(s.image)})` }} />
                    <a className="site" href={s.href} target="_blank" rel="noopener noreferrer" aria-label={fill(ui.detail.visitLabel, { label: s.label, host })}>
                      {/* Late-90s browser window: address bar, viewport, status bar. */}
                      <span className="site__toolbar" aria-hidden="true">
                        <span className="site__label">{ui.detail.address}</span>
                        <span className="site__field">
                          <svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.25" stroke="currentColor" /><path d="M1.75 8h12.5M8 1.75c2 2 2 10.5 0 12.5M8 1.75c-2 2-2 10.5 0 12.5" stroke="currentColor" /></svg>
                          <span className="site__href">{s.href}</span>
                        </span>
                        <span className="site__btn">{ui.detail.go}</span>
                      </span>
                      <span className="site__view">
                        <img src={s.image} alt={s.alt} width={1440} height={900} loading="lazy" decoding="async" />
                      </span>
                      <span className="site__status" aria-hidden="true">
                        <span className="site__cell">{ui.detail.done}</span>
                        <span className="site__cell site__go">
                          {ui.detail.visitSite}
                          <svg viewBox="0 0 12 12" fill="none"><path d="M3 9l6-6M4 3h5v5" stroke="currentColor" strokeWidth="1.2" /></svg>
                        </span>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </section>

      <section ref={nextRef} className="next" aria-label={`${site.nextLabel}: ${next.title}`}>
        <div className="next__frame">
          {ruleTops.map((t, i) => <span key={i} className="next__rule rule" style={{ top: `${t}%` }} />)}
          <div className="next__kicker" data-tt-mask="" style={{ top: `calc(${ruleTops[0]}% + 0.5em)` }}>
            <p className="eyebrow" data-next-copy="">{site.nextLabel} — {String(((index + 1) % projects.length) + 1).padStart(2, '0')} / {String(projects.length).padStart(2, '0')}</p>
          </div>
          {groups.map((g, i) => (
            <div
              key={g}
              className="next__word display-l fit"
              data-tt-mask=""
              style={{
                ['--chars' as string]: Math.max(6, g.length),
                bottom: `calc(${100 - ruleTops[groups.length === 1 ? 2 : i + 1]}% + 0.02em)`,
                left: groups.length === 1 ? '50%' : i === 0 ? '30%' : '70%',
              }}
            >
              <span>{g}</span>
            </div>
          ))}
          <div className="next__stage" />
          <svg className="next__svg" aria-hidden="true" />
          <button className="next__hint body-s" onClick={() => go(projectUrl(next), 'from-next')}>
            <span data-tt-mask=""><span style={{ display: 'block' }} data-next-copy="">{site.continueHint}</span></span>
            <svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 2l8 8M10 3.5V10H3.5" stroke="currentColor" strokeWidth="1.2" /></svg>
          </button>
        </div>
      </section>
    </main>
  );
}
