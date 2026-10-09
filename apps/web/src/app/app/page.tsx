import Link from "next/link";
import { AppNav } from "@/components/AppNav";
import { QueryBox } from "@/components/QueryBox";
import { RepositoryPicker } from "@/components/RepositoryPicker";
import {
  fetchChanges,
  fetchRepositories,
  githubInstallHref,
  type ChangeListItem,
} from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  let loadError: string | null = null;
  let installation = null;
  let repositories: Awaited<
    ReturnType<typeof fetchRepositories>
  >["repositories"] = [];
  let changes: ChangeListItem[] = [];

  try {
    const [repoData, changeData] = await Promise.all([
      fetchRepositories(),
      fetchChanges(5),
    ]);
    installation = repoData.installation;
    repositories = repoData.repositories;
    changes = changeData.changes;
  } catch (error) {
    loadError =
      error instanceof Error
        ? error.message
        : "Could not reach the API. Is it running on :4000?";
  }

  const selected = repositories.filter((repo) => repo.selected);

  return (
    <main>
      <AppNav />
      <h1 className="brand">What changed?</h1>
      <p className="lede">
        Ask about the engineering work OpenCompanyOS has indexed. Answers stay
        tied to the activity that was actually recorded.
      </p>

      {loadError ? <p className="error">{loadError}</p> : null}

      <section className="panel" style={{ marginBottom: "1.25rem" }}>
        <QueryBox />
      </section>

      <section className="panel">
        <h2>This week</h2>
        {changes.length === 0 ? (
          <p className="empty">
            Nothing new in the last 7 days. Open or close an issue while
            webhooks are reaching the API, and it will show up here.
          </p>
        ) : (
          <ul className="repo-list">
            {changes.map((change) => (
              <li className="repo-item" key={change.id}>
                <span className="badge">{change.kind}</span>
                <Link className="repo-name" href={`/app/changes/${change.id}`}>
                  {change.title ?? change.eventType}
                </Link>
                <span className="meta" style={{ margin: 0 }}>
                  {[change.repository?.name, change.actor?.name]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel" style={{ marginTop: "1.25rem" }}>
        {installation ? (
          <details>
            <summary>
              {installation.accountLogin} ·{" "}
              {selected.length === 1
                ? selected[0]?.fullName
                : `${selected.length} repositories`}
            </summary>
            <div style={{ marginTop: "1rem" }}>
              <RepositoryPicker
                installation={installation}
                repositories={repositories}
              />
            </div>
          </details>
        ) : (
          <>
            <h2>Connect GitHub</h2>
            <p className="empty">
              Install the app on your organization, then choose the repositories
              to follow.
            </p>
            <a className="button button-primary" href={githubInstallHref()}>
              Connect GitHub
            </a>
          </>
        )}
      </section>
    </main>
  );
}
