import Link from "next/link";

export default function LandingPage() {
  return (
    <main>
      <h1 className="brand">OpenCompanyOS</h1>
      <p className="lede">
        An organizational context layer for AI agents. Connect a GitHub
        organization, keep a current picture of the work, and ask what changed
        with the evidence beside the answer.
      </p>
      <div className="actions">
        <Link className="button button-primary" href="/app">
          Open the app
        </Link>
      </div>
      <section className="panel">
        <h2>Local demo</h2>
        <ol className="steps">
          <li>Install the GitHub App and select a repository.</li>
          <li>Sync history, then keep new activity arriving through webhooks.</li>
          <li>Ask what changed, and open an entity to see its timeline.</li>
        </ol>
        <p className="meta">
          This page stays the front door. The workspace lives at /app.
        </p>
      </section>
    </main>
  );
}
