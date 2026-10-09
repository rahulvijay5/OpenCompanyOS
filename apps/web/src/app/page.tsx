import { QueryBox } from "@/components/QueryBox";
import { RepositoryPicker } from "@/components/RepositoryPicker";
import {
  fetchChanges,
  fetchEntities,
  fetchRecentEvents,
  fetchRepositories,
  githubInstallHref,
  type ChangeListItem,
  type EntityCount,
  type EntityListItem,
  type EventListItem,
} from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let loadError: string | null = null;
  let installation = null;
  let repositories: Awaited<
    ReturnType<typeof fetchRepositories>
  >["repositories"] = [];
  let events: EventListItem[] = [];
  let entityCounts: EntityCount[] = [];
  let entities: EntityListItem[] = [];
  let changes: ChangeListItem[] = [];

  try {
    const [repoData, eventData, entityData, changeData] = await Promise.all([
      fetchRepositories(),
      fetchRecentEvents(15),
      fetchEntities(30),
      fetchChanges(20),
    ]);
    installation = repoData.installation;
    repositories = repoData.repositories;
    events = eventData.events;
    entityCounts = entityData.counts;
    entities = entityData.entities;
    changes = changeData.changes;
  } catch (error) {
    loadError =
      error instanceof Error
        ? error.message
        : "Could not reach the API. Is it running on :4000?";
  }

  return (
    <main>
      <h1 className="brand">OpenCompanyOS</h1>
      <p className="lede">
        Connect a GitHub App installation, choose repositories, sync history,
        and keep events current through webhooks. AI/RAG comes after ingestion
        is reliable.
      </p>

      <div className="actions">
        <a className="button button-primary" href={githubInstallHref()}>
          Connect GitHub
        </a>
      </div>

      {loadError ? <p className="error">{loadError}</p> : null}

      <section className="panel" style={{ marginBottom: "1.25rem" }}>
        <h2>Query</h2>
        <QueryBox />
      </section>

      <section className="panel">
        <h2>GitHub installation</h2>
        {installation ? (
          <>
            <p className="meta">
              Account <strong>{installation.accountLogin}</strong> (
              {installation.accountType}) · status {installation.status}
            </p>
            <RepositoryPicker
              installation={installation}
              repositories={repositories}
            />
          </>
        ) : (
          <p className="empty">
            No installation stored yet. Click Connect GitHub to install the app
            on a personal account or organization.
          </p>
        )}
      </section>

      <section className="panel" style={{ marginTop: "1.25rem" }}>
        <h2>Canonical entities</h2>
        {entityCounts.length === 0 ? (
          <p className="empty">
            No entities yet. Sync a repository or receive a webhook to project
            people, issues, pull requests, and commits.
          </p>
        ) : (
          <>
            <p className="meta">
              {entityCounts
                .map((row) => `${row.type} ${row.count}`)
                .join(" · ")}
            </p>
            <ul className="repo-list">
              {entities.slice(0, 12).map((entity) => (
                <li className="repo-item" key={entity.id}>
                  <span className="badge">{entity.type}</span>
                  <span className="repo-name">{entity.canonicalName}</span>
                  <span />
                  <span />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="panel" style={{ marginTop: "1.25rem" }}>
        <h2>Changes</h2>
        <p className="meta">
          Activity recorded since webhooks started. Synced issues and pull
          requests stay the current snapshot and are not listed here as history.
        </p>
        {changes.length === 0 ? (
          <p className="empty">No recorded changes in the last 7 days.</p>
        ) : (
          <ul className="repo-list">
            {changes.map((change) => (
              <li className="repo-item" key={change.id}>
                <span className="badge">{change.kind}</span>
                <span className="repo-name">
                  {change.title ?? change.eventType}
                </span>
                {change.url ? (
                  <a href={change.url} target="_blank" rel="noreferrer">
                    open
                  </a>
                ) : (
                  <span />
                )}
                <span className="meta" style={{ margin: 0 }}>
                  {[change.repository?.name, change.actor?.name, change.eventTime]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel" style={{ marginTop: "1.25rem" }}>
        <h2>Recent events</h2>
        {events.length === 0 ? (
          <p className="empty">
            No events yet. Run a sync or open an issue/PR while a webhook tunnel
            is running.
          </p>
        ) : (
          <ul className="repo-list">
            {events.map((event) => (
              <li className="repo-item" key={event.id}>
                <span className="badge">{event.eventType}</span>
                <span className="repo-name">
                  {event.title ?? event.sourceEventId}
                </span>
                {event.htmlUrl ? (
                  <a href={event.htmlUrl} target="_blank" rel="noreferrer">
                    open
                  </a>
                ) : (
                  <span />
                )}
                <span className="meta" style={{ margin: 0 }}>
                  {event.fullName ?? ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
