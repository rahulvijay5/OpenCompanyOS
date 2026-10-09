import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteShell } from "@/components/SiteShell";
import {
  fetchEntities,
  fetchEntity,
  fetchEntityRelationships,
  fetchEntityTimeline,
} from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function EntityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const entityResponse = await fetchEntity(id);
  if (!entityResponse) {
    notFound();
  }

  const [timeline, relationships, catalog] = await Promise.all([
    fetchEntityTimeline(id),
    fetchEntityRelationships(id),
    fetchEntities(200),
  ]);
  const names = new Map(
    catalog.entities.map((entity) => [entity.id, entity.canonicalName]),
  );
  const entity = entityResponse.entity;
  const state =
    typeof entity.metadata.state === "string" ? entity.metadata.state : null;
  const htmlUrl =
    typeof entity.metadata.htmlUrl === "string" ? entity.metadata.htmlUrl : null;

  return (
    <SiteShell>
      <main className="workspace">
        <header className="workspace-header">
          <p className="kicker">
            <Link href="/app">Experiment</Link>
          </p>
          <h1>{entity.canonicalName}</h1>
          <p className="hero-copy">
            {entity.type}
            {state ? ` · ${state}` : ""}
            {htmlUrl ? (
              <>
                {" "}
                ·{" "}
                <a href={htmlUrl} target="_blank" rel="noreferrer">
                  GitHub
                </a>
              </>
            ) : null}
          </p>
        </header>

        <section className="work-section" aria-labelledby="snapshot">
          <p className="section-index">01</p>
          <h2 id="snapshot">Current snapshot</h2>
          <p className="meta">{entity.sourceId}</p>
          {entity.description ? <p>{entity.description}</p> : null}
        </section>

        <section className="work-section" aria-labelledby="timeline">
          <p className="section-index">02</p>
          <h2 id="timeline">Timeline</h2>
          <p className="section-note">
            Occurrences only. The snapshot above is the current state, not a
            transition.
          </p>
          {timeline.events.length === 0 ? (
            <p className="empty">
              No occurrences yet. Synced issues and pull requests stay a
              snapshot until a webhook records a transition.
            </p>
          ) : (
            <ul className="record-list">
              {timeline.events.map((event) => (
                <li className="record" key={event.id}>
                  <span className="record-kind">{event.eventType}</span>
                  <Link href={`/app/changes/${event.id}`}>
                    {event.title ?? event.sourceEventId}
                  </Link>
                  <span className="record-meta">
                    {event.htmlUrl ? (
                      <a href={event.htmlUrl} target="_blank" rel="noreferrer">
                        GitHub
                      </a>
                    ) : null}
                    {event.htmlUrl && event.eventTime ? " · " : null}
                    {event.eventTime ?? ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="work-section" aria-labelledby="relationships">
          <p className="section-index">03</p>
          <h2 id="relationships">Relationships</h2>
          {relationships.relationships.length === 0 ? (
            <p className="empty">No relationships stored for this entity.</p>
          ) : (
            <ul className="record-list">
              {relationships.relationships.map((edge) => {
                const otherId =
                  edge.direction === "outgoing"
                    ? edge.targetEntityId
                    : edge.sourceEntityId;
                return (
                  <li className="record" key={edge.id}>
                    <span className="record-kind">{edge.relationshipType}</span>
                    <Link href={`/app/entities/${otherId}`}>
                      {names.get(otherId) ?? otherId}
                    </Link>
                    <span className="record-meta">
                      {edge.direction}
                      {edge.validFrom ? ` · ${edge.validFrom}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </SiteShell>
  );
}
