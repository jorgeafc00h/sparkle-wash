import { useEffect, useRef, useState } from "react";
import { chapters as allChapters, chaptersByGroup } from "./chapters";
import type { ManualChapter, ManualSection } from "./chapters/types";
import { WalkthroughPlayer } from "./walkthrough";

function Section({ chapterId, section }: { chapterId: string; section: ManualSection }) {
  const anchor = `${chapterId}-${section.id}`;
  return (
    <section className="mn-section" aria-labelledby={anchor}>
      <h3 id={anchor}>{section.title}</h3>
      {section.body.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      {section.steps && (
        <ol className="mn-steps">
          {section.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
      {section.figure && (
        <figure className="mn-figure">
          <img src={section.figure.src} alt={section.figure.alt} loading="lazy" width={1366} height={768} />
          {section.figure.caption && <figcaption>{section.figure.caption}</figcaption>}
        </figure>
      )}
      {section.callout && (
        <aside className={`mn-callout mn-callout--${section.callout.kind}`}>
          <strong>{section.callout.title}</strong>
          <p>{section.callout.body}</p>
        </aside>
      )}
    </section>
  );
}

export function Manual({ chapters = allChapters }: { chapters?: ManualChapter[] }) {
  const [active, setActive] = useState(chapters[0]?.id ?? "");
  const groups = chaptersByGroup(chapters);
  const tocRef = useRef<HTMLDetailsElement>(null);

  // Content renders after the browser tried to jump to #hash, so jump again once it exists.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);

  // The table of contents starts collapsed at phone width and closes after choosing a chapter.
  useEffect(() => {
    if (typeof window.matchMedia === "function" && window.matchMedia("(max-width: 900px)").matches) {
      tocRef.current?.removeAttribute("open");
    }
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.find((e) => e.isIntersecting);
        if (hit) setActive(hit.target.id);
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );
    chapters.forEach((c) => {
      const el = document.getElementById(c.id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, [chapters]);

  return (
    <div className="mn-page">
      <a className="mn-skip" href="#contenido">Saltar al contenido</a>
      <header className="mn-header">
        <div className="mn-header__in">
          <a className="mn-brand" href="/" aria-label="Car Spa, ir al inicio">
            <img src="/brand/car-spa-mark-ondark.svg" alt="" width={40} height={40} />
            <span>Car Spa</span>
          </a>
          <span className="mn-header__title">Manual de escritorio</span>
          <a className="mn-header__link" href="/app/">Abrir la consola</a>
        </div>
      </header>

      <div className="mn-layout">
        <nav className="mn-toc" aria-label="Contenido del manual">
          <details ref={tocRef} className="mn-toc__details" open>
            <summary>Contenido</summary>
            {groups.map((g) => (
              <div key={g.group} className="mn-toc__group">
                <p className="mn-toc__label">{g.group}</p>
                <ol>
                  {g.chapters.map((c) => (
                    <li key={c.id}>
                      <a
                        href={`#${c.id}`}
                        aria-current={active === c.id ? "true" : undefined}
                        onClick={() => {
                          if (typeof window.matchMedia === "function" && window.matchMedia("(max-width: 900px)").matches) tocRef.current?.removeAttribute("open");
                        }}
                      >{c.title}</a>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </details>
        </nav>

        <main id="contenido" className="mn-main" tabIndex={-1}>
          <div className="mn-intro">
            <p className="mn-eyebrow">MANUAL DE USUARIO</p>
            <h1>Manual de Car Spa para escritorio</h1>
            <p>
              Guía paso a paso de la aplicación de escritorio. Las capturas usan datos de demostración: los
              paquetes y precios que verás en tu equipo vienen de tu propio catálogo.
            </p>
          </div>

          {chapters.map((c, idx) => {
            const prev = chapters[idx - 1];
            const next = chapters[idx + 1];
            return (
              <article key={c.id} id={c.id} className="mn-chapter" aria-labelledby={`${c.id}-h`}>
                <p className="mn-eyebrow">{c.group.toUpperCase()} · CAPÍTULO {idx + 1}</p>
                <h2 id={`${c.id}-h`}>{c.title}</h2>
                <p className="mn-lead">{c.summary}</p>
                {c.walkthrough && (
                  <div className="mn-video">
                    <WalkthroughPlayer data={c.walkthrough} lang="es" />
                  </div>
                )}
                {c.sections.map((s) => (
                  <Section key={s.id} chapterId={c.id} section={s} />
                ))}
                <nav className="mn-pager" aria-label={`Navegación desde ${c.title}`}>
                  {prev ? <a href={`#${prev.id}`} rel="prev"><span>Anterior</span>{prev.title}</a> : <span />}
                  {next ? <a href={`#${next.id}`} rel="next"><span>Siguiente</span>{next.title}</a> : <span />}
                </nav>
              </article>
            );
          })}
        </main>
      </div>
    </div>
  );
}

export default Manual;
