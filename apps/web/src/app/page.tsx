import { RepositoryPicker } from "@/components/RepositoryPicker";
import {
  fetchRecentEvents,
  fetchRepositories,
  githubInstallHref,
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

  try {
    const [repoData, eventData] = await Promise.all([
      fetchRepositories(),
      fetchRecentEvents(15),
    ]);
    installation = repoData.installation;
    repositories = repoData.repositories;
    events = eventData.events;
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
