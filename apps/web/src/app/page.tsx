import { RepositoryPicker } from "@/components/RepositoryPicker";
import { fetchRepositories, githubInstallHref } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let loadError: string | null = null;
  let installation = null;
  let repositories: Awaited<
    ReturnType<typeof fetchRepositories>
  >["repositories"] = [];

  try {
    const data = await fetchRepositories();
    installation = data.installation;
    repositories = data.repositories;
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
        Connect a GitHub App installation, choose repositories, and store them
        as the foundation for organizational context. AI/RAG comes later — the
        ingestion pipeline comes first.
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
    </main>
  );
}
