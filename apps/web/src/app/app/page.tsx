import Link from "next/link";
import { QueryBox } from "@/components/QueryBox";
import { RepositoryPicker } from "@/components/RepositoryPicker";
import { SiteShell } from "@/components/SiteShell";
import {
  fetchChanges,
  fetchRepositories,
  githubInstallHref,
  type ChangeListItem,
} from "@/lib/api";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Experiment — OpenCompanyOS",
  description:
    "Ask about indexed GitHub activity. Answers stay tied to the records OpenCompanyOS has actually stored.",
};

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
  const reading =
    selected.length === 1
      ? selected[0]?.fullName
      : selected.length > 1
        ? `${selected.length} repositories`
        : installation?.accountLogin;

  return (
    <SiteShell>
      <main className="workspace">
        <header className="workspace-header">
          <p className="kicker">Experiment · GitHub</p>
          <h1>What changed?</h1>
          <p className="hero-copy">
            Ask about the engineering work OpenCompanyOS has indexed. The
            answer stays on the left. Confidence, timing, and the records it
            used stay on the right.
          </p>
        </header>

        {loadError ? <p className="error">{loadError}</p> : null}

        <section className="ask-section" aria-label="Question">
          {installation ? (
            <details className="repo-disclosure">
              <summary>Reading {reading}</summary>
              <p className="section-note">
                These are the repositories this question is allowed to use.
                Save a change before asking again.
              </p>
              <RepositoryPicker
                installation={installation}
                repositories={repositories}
              />
            </details>
          ) : (
            <p className="workspace-connect">
              <a className="site-btn" href={githubInstallHref()}>
                Connect GitHub
              </a>
            </p>
          )}
          <QueryBox />
        </section>

        <section className="recent-activity" aria-labelledby="recent">
          <h2 id="recent">Recent activity</h2>
          <p className="section-note">
            Events recorded in the last 7 days. Open one to see what happened
            and what that record looks like now.
          </p>
          {changes.length === 0 ? (
            <p className="empty">
              Nothing new in the last 7 days. Open or close an issue while
              webhooks are reaching the API, and it will show up here.
            </p>
          ) : (
            <ul className="record-list">
              {changes.map((change) => (
                <li className="record" key={change.id}>
                  <span className="record-kind">{change.kind}</span>
                  <Link href={`/app/changes/${change.id}`}>
                    {change.title ?? change.eventType}
                  </Link>
                  <span className="record-meta">
                    {[change.repository?.name, change.actor?.name]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </SiteShell>
  );
}
