import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/SiteShell";

export const metadata: Metadata = {
  title: "Memo — OpenCompanyOS",
  description:
    "A working thesis on organizational knowledge, software systems, and the context required for useful AI agents.",
};

const CONTENTS = [
  ["thesis", "The thesis"],
  ["fragmentation", "The fragmentation problem"],
  ["search", "Why search alone is insufficient"],
  ["context", "What we mean by organizational context"],
  ["agents", "Why this matters for AI agents"],
  ["github", "The first experiment: GitHub"],
  ["principles", "Architectural principles"],
  ["not", "What this project is not"],
  ["questions", "Open questions"],
  ["roadmap", "Research and engineering roadmap"],
  ["closing", "Closing thesis"],
] as const;

export default function MemoPage() {
  return (
    <SiteShell>
      <main className="memo">
        <header className="memo-header">
          <p className="kicker">Research memo · 2026 · working thesis</p>
          <h1>Toward an Organizational Context Engine</h1>
          <p className="memo-subtitle">
            A working thesis on organizational knowledge, software systems, and
            the context required for useful AI agents.
          </p>
        </header>

        <nav className="toc" aria-label="Contents">
          <p>Contents</p>
          <ol>
            {CONTENTS.map(([id, label], index) => (
              <li key={id}>
                <a href={`#${id}`}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article>
          <section id="thesis">
            <h2>
              <span>01</span> The thesis
            </h2>
            <p>
              Organizations produce information continuously, but their
              operational knowledge remains distributed across tools, records,
              relationships, and people.
            </p>
            <p>
              The goal is not simply to aggregate data. It is to create a
              consistent representation of what an organization knows, how that
              knowledge is connected, when it was observed, and what evidence
              supports it.
            </p>
          </section>

          <section id="fragmentation">
            <h2>
              <span>02</span> The fragmentation problem
            </h2>
            <p>
              A repository describes where code lives. An issue describes a
              problem someone chose to track. A pull request describes a
              proposed change. A commit describes a snapshot of files. A review
              describes a judgment. A person appears, under different names, in
              all of them.
            </p>
            <p>
              Each system is useful on its own terms. GitHub already offers
              search, timelines, and links between many of these records.
              Cross-cutting questions still often require a person to open
              several of those records and decide how they fit together: which
              issue a change addressed, who was involved, what the object looks
              like now, and which earlier event is still relevant.
            </p>
          </section>

          <section id="search">
            <h2>
              <span>03</span> Why search alone is insufficient
            </h2>
            <p>
              Search retrieves documents that match a query. Context is the
              smaller, structured set of facts a question actually depends on.
              Assembling it can require exact entity resolution, a sense of
              time, the current state of an object, the events that led there,
              the relationships among records, provenance for each fact, and an
              explicit account of what is still unknown.
            </p>
            <p>
              A fluent summary from a language model is not the same thing as a
              verified account of what happened. A paragraph can sound complete
              while citing the wrong pull request, treating a current label as
              if it had always been true, or filling a gap the records do not
              cover.
            </p>
          </section>

          <section id="context">
            <h2>
              <span>04</span> What we mean by organizational context
            </h2>
            <dl className="defs">
              <div>
                <dt>Entities</dt>
                <dd>
                  Repositories, people, issues, pull requests, commits, and
                  other identifiable objects.
                </dd>
              </div>
              <div>
                <dt>Relationships</dt>
                <dd>Connections between those objects.</dd>
              </div>
              <div>
                <dt>Current state</dt>
                <dd>The latest available snapshot of an object.</dd>
              </div>
              <div>
                <dt>Events</dt>
                <dd>Recorded occurrences of activity.</dd>
              </div>
              <div>
                <dt>Provenance</dt>
                <dd>Where information originated and when it was observed.</dd>
              </div>
              <div>
                <dt>Scope</dt>
                <dd>Which records a request is permitted to use.</dd>
              </div>
              <div>
                <dt>Evidence</dt>
                <dd>Source records that support an explanation.</dd>
              </div>
              <div>
                <dt>Uncertainty</dt>
                <dd>
                  Information that is missing, ambiguous, incomplete, or
                  unverified.
                </dd>
              </div>
            </dl>
            <figure className="package">
              <figcaption>A context package, conceptually</figcaption>
              <ol aria-label="Parts of a context package">
                <li>Entities, relationships, current state, and events</li>
                <li>Scope and provenance constrain what may be used</li>
                <li>Evidence and uncertainty travel with the result</li>
              </ol>
            </figure>
            <p>
              The package is the unit we want both a person and a later agent
              interface to receive: not an unbounded dump of a workspace, and
              not a paragraph with the sources stripped away.
            </p>
          </section>

          <section id="agents">
            <h2>
              <span>05</span> Why this matters for AI agents
            </h2>
            <p>
              An agent that receives only a handful of search hits still has to
              guess which objects they refer to, whether those objects are
              current, and which statements are safe to treat as fact. Useful
              assistance needs relevant context, stable identifiers, clear
              boundaries, source evidence, and a way to separate what the
              records support from what is being assumed.
            </p>
            <p>
              Agent-facing APIs are a long-term direction: a consistent,
              structured interface over organizational context. This project
              does not operate a company, and it does not claim autonomous
              action across an organization&apos;s systems.
            </p>
          </section>

          <section id="github">
            <h2>
              <span>06</span> The first experiment: GitHub
            </h2>
            <p>
              Context Engine v1 is an early implementation inside this
              repository, limited to one GitHub installation. What exists today:
            </p>
            <ul>
              <li>A GitHub App for installation and repository selection.</li>
              <li>
                Synchronization of selected repositories, plus webhook
                ingestion for activity after install.
              </li>
              <li>
                Persisted entities, a small set of relationship types, and
                events. Issues and pull requests from the initial sync are
                stored as current snapshots. Later webhook transitions become
                occurrences. Commits, comments, and reviews are stored as
                occurrences.
              </li>
              <li>
                Retrieval over that store with Postgres full text and pgvector.
              </li>
              <li>
                A Context Engine that builds a versioned context package for a
                scoped request. Scope is the installation&apos;s selected
                repositories. Authorization in this prototype is a single local
                owner, not per-user permissions.
              </li>
              <li>
                Structured uncertainty when a subject is ambiguous, unresolved,
                out of scope, or unsupported by the recorded history.
              </li>
              <li>
                Evidence references checked on the server. The model may cite
                ids from the package; other ids are dropped, and URLs are
                copied from stored records.
              </li>
              <li>
                A human-facing query API and a structured context API, with a
                small workspace at <Link href="/app">/app</Link>.
              </li>
            </ul>
            <p>
              The experiment does not fully reconstruct history that was never
              ingested as events. Review coverage depends on what webhooks
              deliver. It does not understand a codebase as a compiler would.
              It is not multi-user, and it is not production infrastructure.
            </p>
          </section>

          <section id="principles">
            <h2>
              <span>07</span> Architectural principles
            </h2>
            <ol className="principles-list">
              <li>Reuse existing systems of record.</li>
              <li>
                Preserve the difference between snapshots and observed events.
              </li>
              <li>
                Prefer deterministic resolution when identifiers are available.
              </li>
              <li>Enforce data scope at retrieval boundaries.</li>
              <li>Keep source provenance attached to context.</li>
              <li>Make missing information explicit.</li>
              <li>
                Separate context construction from natural-language generation.
              </li>
              <li>
                Evaluate correctness independently of the model&apos;s fluency.
              </li>
            </ol>
          </section>

          <section id="not">
            <h2>
              <span>08</span> What this project is not
            </h2>
            <p>
              OpenCompanyOS is not meant to be another chatbot over GitHub, a
              replacement for GitHub, a generic project-management interface, or
              an agent that invents organizational knowledge.
            </p>
            <p>
              It is an experiment in the context infrastructure that useful
              organizational AI may require.
            </p>
          </section>

          <section id="questions">
            <h2>
              <span>09</span> Open questions
            </h2>
            <ul>
              <li>How can we measure context quality?</li>
              <li>
                How do we reconstruct historical knowledge without inventing
                events?
              </li>
              <li>How should people and identities be resolved?</li>
              <li>
                How should permissions propagate across data sources?
              </li>
              <li>How do we distinguish correlation from causality?</li>
              <li>
                How do we prevent plausible but unsupported explanations?
              </li>
              <li>
                What context is useful enough that engineers return to the
                product?
              </li>
            </ul>
          </section>

          <section id="roadmap">
            <h2>
              <span>10</span> Research and engineering roadmap
            </h2>
            <dl className="roadmap">
              <div>
                <dt>Now</dt>
                <dd>
                  Validate Context Engine correctness, retrieval scope, evidence
                  integrity, and uncertainty handling.
                </dd>
              </div>
              <div>
                <dt>Next</dt>
                <dd>
                  Enrich GitHub relationships and evaluate real engineering
                  questions.
                </dd>
              </div>
              <div>
                <dt>Later</dt>
                <dd>
                  Planned, not shipped: additional integrations, broader
                  organizational context, and stable agent-facing interfaces.
                </dd>
              </div>
            </dl>
          </section>

          <section id="closing">
            <h2>
              <span>11</span> Closing thesis
            </h2>
            <p>
              The long-term opportunity is not to build another interface for
              information that already exists. It is to build the context layer
              that makes that information more coherent, verifiable, and useful
              to people and AI systems.
            </p>
            <p className="status-note">
              This memo is a working thesis. The implementation is
              experimental and will change as the questions above get sharper
              answers.
            </p>
          </section>
        </article>
      </main>
    </SiteShell>
  );
}
