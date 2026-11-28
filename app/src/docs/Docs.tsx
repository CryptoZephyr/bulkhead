// The Bulkhead docs (#/docs/<page>). Plain answers first; the technical detail sits in an
// "Under the hood" hatch at the end of a section. Built from the app's own plates, seams and type,
// so the docs read as part of the product. Only written pages are listed: no placeholders.
import { useEffect } from "react";
import { Lockup } from "../ui/Mark";
import { NetworkReadout, FooterRow } from "../ui/Shell";
import { PAGES, SECTIONS, type DocPage } from "./pages";
import "./docs.css";

export const VERIFIED = "28 November 2026";

export function DocsScreen({ slug }: { slug: string }) {
  const page = PAGES.find((p) => p.slug === slug) ?? PAGES[0];
  const i = PAGES.indexOf(page);
  const next = PAGES[i + 1];
  useEffect(() => { document.title = `${page.title} · Bulkhead docs`; }, [page]);

  return (
    <div className="docs">
      <header className="docs-top">
        <a href="#/" aria-label="Bulkhead home" className="docs-home"><Lockup size={26} /></a>
        <span className="docs-tag">Docs</span>
        <span className="docs-readout"><NetworkReadout /></span>
        <a className="btn btn-primary docs-open" href="#/hull">Open the app</a>
      </header>

      <div className="docs-body">
        <nav className="docs-rail" aria-label="Docs pages">
          {SECTIONS.map((s) => {
            const pages = PAGES.filter((p) => p.section === s.id);
            if (!pages.length) return null;
            return (
              <div key={s.id} className="docs-compartment">
                <span className="docs-compartment-name">{s.name}</span>
                {pages.map((p) => (
                  <a key={p.slug} href={`#/docs/${p.slug}`} className={p === page ? "on" : ""} aria-current={p === page ? "page" : undefined}>{p.title}</a>
                ))}
              </div>
            );
          })}
        </nav>

        <article className="docs-page" aria-labelledby="docs-title">
          <span className="docs-section-sign">{SECTIONS.find((s) => s.id === page.section)?.name}</span>
          <h1 id="docs-title">{page.title}</h1>
          <p className="docs-lead">{page.lead}</p>
          {page.body()}
          <footer className="docs-foot">
            {next && <a className="docs-next" href={`#/docs/${next.slug}`}><span>Next</span>{next.title}</a>}
            <p className="docs-verified">Last checked {VERIFIED} against commit <span className="mono">{__COMMIT__}</span>. Every claim on this page is listed with its source in <a href="https://github.com/CryptoZephyr/bulkhead/blob/main/docs/CLAIMS.md" target="_blank" rel="noreferrer">CLAIMS.md</a>.</p>
          </footer>
        </article>
      </div>
      <FooterRow />
    </div>
  );
}

export type { DocPage };
