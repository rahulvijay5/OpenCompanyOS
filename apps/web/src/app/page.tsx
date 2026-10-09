import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/SiteShell";

export const metadata: Metadata = {
  title: "OpenCompanyOS",
  description:
    "An experiment in building organizational context from the systems where work happens, starting with GitHub.",
};

const STEPS = [
  { label: "GitHub", detail: "The first system of record" },
  { label: "Ingestion and events", detail: "Sync and webhook activity" },
  { label: "Organizational context", detail: "Entities, state, and relations" },
  { label: "Evidence-backed answers", detail: "Query and context APIs" },
];

export default function LandingPage() {
  return (
    <SiteShell>
      <main>
        <section className="hero">
          <div>
            <p className="kicker">
              Independent research &amp; engineering project · 2026
            </p>
            <h1>Software has a codebase. Organizations need a context layer.</h1>
            <p className="hero-copy">
              OpenCompanyOS is an experiment in building organizational context
              from the systems where work happens—starting with GitHub.
            </p>
            <div className="hero-actions">
              <Link className="site-btn" href="/app">
                Explore the experiment
              </Link>
              <Link className="site-btn site-btn-quiet" href="/memo">
                Read the memo
              </Link>
            </div>
          </div>
          <aside className="hero-aside" aria-label="Project status">
            <p>
              <span>Status</span>
              Experimental
            </p>
            <p>
              <span>First integration</span>
              GitHub
            </p>
            <p>
              <span>Working surface</span>
              /app
            </p>
          </aside>
        </section>

        <section className="band" aria-labelledby="problem">
          <p className="section-index">01</p>
          <div>
            <h2 id="problem">The problem isn&apos;t a lack of information.</h2>
            <p>
              Code, issues, pull requests, events, and people already leave
              traces of how an organization works. The missing piece is a
              reliable way to connect them, understand what changed, and
              preserve the evidence behind an explanation.
            </p>
          </div>
        </section>

        <section aria-labelledby="principles">
          <div className="section-head">
            <p className="section-index">02</p>
            <h2 id="principles">Design principles</h2>
            <p className="section-note">
              Directions for the work, not a claim that each one is finished.
            </p>
          </div>
          <ol className="principles">
            <li>
              <h3>Connect</h3>
              <p>
                Relate repositories, people, issues, pull requests, and other
                work artifacts.
              </p>
            </li>
            <li>
              <h3>Understand</h3>
              <p>
                Distinguish current state, observed events, and the
                relationships connecting them.
              </p>
            </li>
            <li>
              <h3>Ground</h3>
              <p>
                Keep explanations connected to source evidence and make
                uncertainty explicit.
              </p>
            </li>
          </ol>
        </section>

        <section className="band" aria-labelledby="direction">
          <p className="section-index">03</p>
          <div>
            <h2 id="direction">How the current direction fits together</h2>
            <p className="section-note">
              A conceptual overview. Not a live status board, and not a claim
              about systems beyond GitHub.
            </p>
            <ol className="pipeline" aria-label="Conceptual architecture">
              {STEPS.map((step, index) => (
                <li key={step.label}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{step.label}</strong>
                  <em>{step.detail}</em>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="experiment">
          <div className="section-head">
            <p className="section-index">04</p>
            <h2 id="experiment">Start with the work already happening.</h2>
          </div>
          <div className="split">
            <div>
              <p>
                The current experiment connects a GitHub App, stores issues,
                pull requests, and commits, represents selected relationships
                and events, and offers a Context Engine for scoped retrieval
                and evidence-backed responses.
              </p>
              <p>
                It is early. Historical completeness, richer engineering
                relationships, evaluation, and multi-user authorization are
                still open work. The workspace at /app is the experiment
                itself, not a preview of a finished product.
              </p>
              <Link className="site-btn" href="/app">
                Open the experiment
              </Link>
            </div>
            <ul className="fact-list">
              <li>Repository selection and synchronization</li>
              <li>Webhook ingestion after install</li>
              <li>Scoped retrieval over selected repositories</li>
              <li>Answers that keep source evidence attached</li>
            </ul>
          </div>
        </section>

        <section className="close" aria-labelledby="close">
          <h2 id="close">Build context before building agents.</h2>
          <p>
            AI systems can only reason reliably about an organization when they
            have access to relevant, well-scoped information and a clear
            account of what that information supports.
          </p>
          <p>OpenCompanyOS is an exploration of that foundation.</p>
          <Link className="text-link" href="/memo">
            Read the memo
          </Link>
        </section>
      </main>
    </SiteShell>
  );
}
