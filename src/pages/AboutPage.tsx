import { useEffect, useRef, type ReactNode } from 'react';
import { site } from '../content/projects';
import { about } from '../content/about';
import type { Link } from '../content/types';
import { session } from '../app/session';
import { gsap, ScrollTrigger, SplitText, EASE, prefersReducedMotion } from '../motion/tokens';
import { HoverText } from '../components/HoverText';
import { AskChat } from '../components/AskChat';
import { ui } from '../content/ui';

const external = (href: string) => /^https?:/.test(href);

function Btn({ link }: { link: Link }) {
  return (
    <a className="btn" href={link.href} data-hover="" target={external(link.href) ? '_blank' : undefined} rel={external(link.href) ? 'noopener noreferrer' : undefined}>
      <HoverText text={link.label} />
    </a>
  );
}

/** Masked line that rises into place (animated by the page timeline). */
function Rv({ className, children }: { className?: string; children: ReactNode }) {
  return <div data-tt-mask=""><div className={className} data-rv="">{children}</div></div>;
}

/** Titled section with a rule on top; every block reveals as it scrolls in. */
function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="profile__block" aria-labelledby={id}>
      <span className="rule" />
      <Rv><h2 id={id} className="eyebrow">{title}</h2></Rv>
      <div className="profile__block-body">{children}</div>
    </section>
  );
}

export function AboutPage() {
  const mainRef = useRef<HTMLElement>(null);
  const { contact } = about;

  useEffect(() => {
    session.introDone = true;
    document.documentElement.removeAttribute('data-preload');
    const reduced = prefersReducedMotion();
    const main = mainRef.current!;
    const splits: SplitText[] = [];
    const ctx = gsap.context(() => {
      gsap.set(main, { autoAlpha: 1 });
      if (reduced) return;

      // Hero entrance.
      const hero = main.querySelector('.profile__hero')!;
      const name = new SplitText(hero.querySelector('.profile__name')!, { type: 'lines', mask: 'lines', linesClass: 'rv-line' });
      splits.push(name);
      const heroItems = hero.querySelectorAll('[data-rv]');
      const heroRules = hero.querySelectorAll('.rule');
      gsap.set(name.lines, { yPercent: 120 });
      gsap.set(heroItems, { yPercent: 120 });
      gsap.set(heroRules, { scaleX: 0, transformOrigin: 'left center' });
      const tl = gsap.timeline({ delay: 0.05 });
      tl.fromTo(main, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6, ease: 'main' }, 0);
      // The line masks only matter while the name rises; left on, they cut the J's descender.
      tl.to(name.lines, { yPercent: 0, duration: 0.7, ease: EASE.glide, stagger: 0.08, onComplete: () => name.revert() }, 0.05);
      tl.to(heroRules, { scaleX: 1, duration: 0.9, ease: EASE.glide, stagger: 0.06 }, 0.08);
      tl.to(heroItems, { yPercent: 0, duration: 0.7, ease: EASE.glide, stagger: 0.03 }, 0.12);
      // Chat panel: opens top-down like the nav dialog, then its content fades up while its rules draw with the others.
      tl.fromTo(hero.querySelector('.ask'), { clipPath: 'inset(0% 0% 100% 0% round 0.4em)' }, { clipPath: 'inset(0% 0% 0% 0% round 0.4em)', duration: 0.9, ease: EASE.glide, clearProps: 'clipPath' }, 0.15);
      tl.from(hero.querySelectorAll('.ask__head .eyebrow, .ask__log, .ask__input'), { autoAlpha: 0, y: '0.8em', duration: 0.8, ease: EASE.glide, stagger: 0.05 }, 0.3);

      // Intro statement + bio lines rise as they enter.
      main.querySelectorAll<HTMLElement>('[data-split]').forEach((el) => {
        const s = new SplitText(el, { type: 'lines', mask: 'lines', linesClass: 'rv-line' });
        splits.push(s);
        gsap.from(s.lines, { yPercent: 120, duration: 0.8, ease: EASE.glide, stagger: 0.06, scrollTrigger: { trigger: el, start: 'top 90%' } });
      });
      const portrait = main.querySelector('.profile__portrait');
      if (portrait) {
        gsap.from(portrait, { clipPath: 'inset(100% 0% 0% 0%)', duration: 1.1, ease: EASE.glide, scrollTrigger: { trigger: portrait, start: 'top 85%' } });
      }

      // Section blocks and contact: rules draw, lines rise, buttons pop.
      main.querySelectorAll<HTMLElement>('.profile__block, .profile__contact').forEach((block) => {
        const rules = block.querySelectorAll('.rule');
        const items = block.querySelectorAll('[data-rv]');
        const buttons = block.querySelectorAll('.btn');
        gsap.set(rules, { scaleX: 0, transformOrigin: 'left center' });
        gsap.set(items, { yPercent: 120 });
        gsap.set(buttons, { scale: 0.6, autoAlpha: 0 });
        const t = gsap.timeline({ scrollTrigger: { trigger: block, start: 'top 85%' } });
        t.to(rules, { scaleX: 1, duration: 0.9, ease: EASE.glide, stagger: 0.05 }, 0);
        t.to(items, { yPercent: 0, duration: 0.7, ease: EASE.glide, stagger: 0.025 }, 0.05);
        t.to(buttons, { scale: 1, autoAlpha: 1, duration: 0.5, ease: 'back.out(2.2)', stagger: 0.07 }, 0.25);
      });
    }, main);
    requestAnimationFrame(() => ScrollTrigger.refresh());
    return () => {
      ctx.revert();
      splits.forEach((s) => s.revert());
    };
  }, []);

  const facts: { label: string; value: ReactNode }[] = [
    about.location ? { label: ui.about.basedIn, value: about.location } : null,
    about.availability ? { label: ui.about.status, value: about.availability } : null,
    { label: ui.about.email, value: <a href={`mailto:${contact.email}`} className="profile__inline-link">{contact.email}</a> },
  ].filter(Boolean) as { label: string; value: ReactNode }[];

  return (
    <main ref={mainRef} className="profile" style={{ visibility: 'hidden' }}>
      <section className="profile__hero" aria-labelledby="about-title">
        <h1 id="about-title" className="profile__name display-xl fit" style={{ ['--chars' as string]: site.name.length }}>{site.name}</h1>
        <Rv className="profile__sub body-s">
          <span className="eyebrow">{about.headline}</span>
        </Rv>
        <AskChat />
        <div className="profile__facts">
          {facts.map((f) => (
            <div className="profile__row" key={f.label}>
              <span className="rule" />
              <Rv><p className="eyebrow">{f.label}</p></Rv>
              <Rv className="v body-s">{f.value}</Rv>
            </div>
          ))}
        </div>
      </section>

      <section className="profile__intro" aria-label={ui.about.bioLabel}>
        <figure className="profile__portrait" data-empty={!about.portrait}>
          {about.portrait
            ? <img src={about.portrait.src} alt={about.portrait.alt} onLoad={() => ScrollTrigger.refresh()} />
            : <span className="display-l" aria-hidden="true">{site.mark}</span>}
        </figure>
        <div className="profile__bio">
          <p className="profile__statement display-m" data-split="">{about.intro}</p>
          {about.bio.map((para, i) => <p key={i} className="body-m" data-split="">{para}</p>)}
        </div>
      </section>

      {about.experience.length ? (
        <Block id="about-experience" title={ui.about.experience}>
          {about.experience.map((x, i) => (
            <div className="profile__entry" key={i}>
              <span className="rule" />
              <Rv className="profile__when body-s">{x.period}</Rv>
              <div className="profile__what">
                <Rv><p className="display-xs">{x.role}</p></Rv>
                <Rv>
                  <p className="body-m">{x.href ? <a className="profile__inline-link" href={x.href} target="_blank" rel="noopener noreferrer">{x.company}</a> : x.company}</p>
                </Rv>
                {x.summary ? <Rv><p className="profile__summary body-s">{x.summary}</p></Rv> : null}
              </div>
              <Rv className="profile__where body-s">{x.location ?? ''}</Rv>
            </div>
          ))}
        </Block>
      ) : null}

      {about.skills.length ? (
        <Block id="about-skills" title={ui.about.skills}>
          <div className="profile__skills">
            {about.skills.map((g) => (
              <div className="profile__skill" key={g.group}>
                <Rv><h3 className="eyebrow">{g.group}</h3></Rv>
                <ul>
                  {g.items.map((s) => <li key={s}><Rv className="body-m">{s}</Rv></li>)}
                </ul>
              </div>
            ))}
          </div>
        </Block>
      ) : null}

      {about.education?.length ? (
        <Block id="about-education" title={ui.about.education}>
          {about.education.map((e, i) => (
            <div className="profile__entry" key={i}>
              <span className="rule" />
              <Rv className="profile__when body-s">{e.period}</Rv>
              <div className="profile__what">
                <Rv><p className="display-xs">{e.degree}</p></Rv>
                <Rv><p className="body-m">{e.school}</p></Rv>
                {e.note ? <Rv><p className="profile__summary body-s">{e.note}</p></Rv> : null}
              </div>
              <span />
            </div>
          ))}
        </Block>
      ) : null}

      {about.recognition?.length ? (
        <Block id="about-recognition" title={ui.about.recognition}>
          {about.recognition.map((r, i) => (
            <div className="profile__entry" key={i}>
              <span className="rule" />
              <Rv className="profile__when body-s">{r.year}</Rv>
              <div className="profile__what">
                <Rv><p className="display-xs">{r.title}</p></Rv>
                <Rv><p className="body-m">{r.issuer}</p></Rv>
              </div>
              <span />
            </div>
          ))}
        </Block>
      ) : null}

      <section className="profile__contact" aria-labelledby="about-contact">
        <span className="rule" />
        <Rv><h2 id="about-contact" className="eyebrow">{ui.about.contact}</h2></Rv>
        <a className="profile__prompt display-l fit" href={`mailto:${contact.email}`} style={{ ['--chars' as string]: contact.prompt.length }} data-hover="">
          <Rv><HoverText text={contact.prompt} /></Rv>
        </a>
        <Rv className="body-m">
          <a className="profile__inline-link" href={`mailto:${contact.email}`}>{contact.email}</a>
          {contact.phone ? <>&nbsp;&nbsp;·&nbsp;&nbsp;<a className="profile__inline-link" href={`tel:${contact.phone.replace(/\s+/g, '')}`}>{contact.phone}</a></> : null}
        </Rv>
        <div className="profile__links">
          {contact.resume ? <Btn link={contact.resume} /> : null}
          {contact.socials.map((s) => <Btn key={s.label} link={s} />)}
        </div>
      </section>
    </main>
  );
}
