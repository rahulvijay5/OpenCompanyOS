import Link from "next/link";
import { redirect } from "next/navigation";
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
      <main>
        <h1 className="brand">OpenCompanyOS</h1>
        <p className="error">
          Missing <code>installation_id</code> from GitHub setup redirect.
        </p>
        <Link className="button button-secondary" href="/app">
          Back to the app
        </Link>
      </main>
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
    <main>
      <h1 className="brand">OpenCompanyOS</h1>
      <p className="error">{setupError}</p>
      <Link className="button button-secondary" href="/app">
        Back to the app
      </Link>
    </main>
  );
}
