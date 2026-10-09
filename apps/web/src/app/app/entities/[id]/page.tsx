import Link from "next/link";
import { notFound } from "next/navigation";
import { AppNav } from "@/components/AppNav";
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
    <main>
      <AppNav />
      <p className="meta">
        <Link href="/app">Workspace</Link>
      </p>
      <h1 className="brand">{entity.canonicalName}</h1>
      <p className="lede">
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

      <section className="panel">
        <h2>Current snapshot</h2>
        <p className="meta">{entity.sourceId}</p>
        {entity.description ? <p>{entity.description}</p> : null}
      </section>

      <section className="panel" style={{ marginTop: "1.25rem" }}>
        <h2>Timeline</h2>
        <p className="meta">
          Occurrences only. The snapshot above is the current state, not a
          transition.
        </p>
        {timeline.events.length === 0 ? (
          <p className="empty">
            No occurrences yet. Synced issues and pull requests stay a snapshot
            until a webhook records a transition.
          </p>
        ) : (
          <ul className="repo-list">
            {timeline.events.map((event) => (
              <li className="repo-item" key={event.id}>
                <span className="badge">{event.eventType}</span>
                <Link className="repo-name" href={`/app/changes/${event.id}`}>
                  {event.title ?? event.sourceEventId}
                </Link>
                {event.htmlUrl ? (
                  <a href={event.htmlUrl} target="_blank" rel="noreferrer">
                    GitHub
                  </a>
                ) : (
                  <span />
                )}
                <span className="meta" style={{ margin: 0 }}>
                  {event.eventTime ?? ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel" style={{ marginTop: "1.25rem" }}>
        <h2>Relationships</h2>
        {relationships.relationships.length === 0 ? (
          <p className="empty">No relationships stored for this entity.</p>
        ) : (
          <ul className="repo-list">
            {relationships.relationships.map((edge) => {
              const otherId =
                edge.direction === "outgoing"
                  ? edge.targetEntityId
                  : edge.sourceEntityId;
              return (
                <li className="repo-item" key={edge.id}>
                  <span className="badge">{edge.relationshipType}</span>
                  <Link className="repo-name" href={`/app/entities/${otherId}`}>
                    {names.get(otherId) ?? otherId}
                  </Link>
                  <span className="meta" style={{ margin: 0 }}>
                    {edge.direction}
                  </span>
                  <span className="meta" style={{ margin: 0 }}>
                    {edge.validFrom ?? ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
