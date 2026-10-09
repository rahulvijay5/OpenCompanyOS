import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteShell } from "@/components/SiteShell";
import { completeGithubSetup } from "@/lib/api";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function GithubSetupPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const rawInstallationId = params.installation_id;
  const installationId = Array.isArray(rawInstallationId)
    ? rawInstallationId[0]
    : rawInstallationId;

  if (!installationId) {
    return (
      <SiteShell>
        <main className="workspace">
          <header className="workspace-header">
            <p className="kicker">GitHub</p>
            <h1>Setup did not finish</h1>
            <p className="error">
              Missing <code>installation_id</code> from the GitHub setup
              redirect.
            </p>
            <Link className="site-btn" href="/app">
              Back to the experiment
            </Link>
          </header>
        </main>
      </SiteShell>
    );
  }

  let setupError: string | null = null;
  try {
    await completeGithubSetup(installationId);
  } catch (error) {
    setupError =
      error instanceof Error ? error.message : "GitHub setup failed";
  }

  if (!setupError) {
    redirect("/app?connected=1");
  }

  return (
    <SiteShell>
      <main className="workspace">
        <header className="workspace-header">
          <p className="kicker">GitHub</p>
          <h1>Setup did not finish</h1>
          <p className="error">{setupError}</p>
          <Link className="site-btn" href="/app">
            Back to the experiment
          </Link>
        </header>
      </main>
    </SiteShell>
  );
}
