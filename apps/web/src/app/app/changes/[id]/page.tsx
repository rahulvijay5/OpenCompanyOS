import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteShell } from "@/components/SiteShell";
import { fetchChange } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function ChangePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const found = await fetchChange(id);
  if (!found) {
    notFound();
  }
  const { change, snapshot } = found;
  const state =
    snapshot && typeof snapshot.metadata.state === "string"
      ? snapshot.metadata.state
      : null;

  return (
    <SiteShell>
      <main className="workspace">
        <header className="workspace-header">
          <p className="kicker">
            <Link href="/app">Experiment</Link>
          </p>
          <h1>{change.title ?? change.eventType}</h1>
          <p className="hero-copy">
            {change.kind} · {change.eventType}
            {change.eventTime ? ` · ${change.eventTime}` : ""}
          </p>
        </header>

        <section className="work-section" aria-labelledby="occurrence">
          <p className="section-index">01</p>
          <h2 id="occurrence">Occurrence</h2>
          <p>
            {change.actor ? `By ${change.actor.name}` : "Actor unknown"}
            {change.repository?.name ? ` in ${change.repository.name}` : ""}
          </p>
          {change.url ? (
            <p>
              <a href={change.url} target="_blank" rel="noreferrer">
                Open on GitHub
              </a>
            </p>
          ) : null}
          <p className="meta">{change.sourceEventId}</p>
        </section>

        {snapshot ? (
          <section className="work-section" aria-labelledby="snapshot">
            <p className="section-index">02</p>
            <h2 id="snapshot">Current snapshot</h2>
            <p>
              <Link href={`/app/entities/${snapshot.id}`}>
                {snapshot.canonicalName}
              </Link>
              {state ? ` · ${state}` : ""}
            </p>
            <p className="meta">{snapshot.type}</p>
          </section>
        ) : null}

        {change.object && change.object.id !== snapshot?.id ? (
          <section className="work-section" aria-labelledby="object">
            <p className="section-index">03</p>
            <h2 id="object">Object</h2>
            <p>
              <Link href={`/app/entities/${change.object.id}`}>
                {change.object.name}
              </Link>
            </p>
          </section>
        ) : null}
      </main>
    </SiteShell>
  );
}
