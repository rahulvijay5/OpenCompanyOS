import Link from "next/link";
import { notFound } from "next/navigation";
import { AppNav } from "@/components/AppNav";
import { fetchChange } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function ChangePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const found = await fetchChange(id);
  if (!found) {
    notFound();
  }
  const { change, snapshot } = found;
  const state =
    snapshot && typeof snapshot.metadata.state === "string"
      ? snapshot.metadata.state
      : null;

  return (
    <main>
      <AppNav />
      <p className="meta">
        <Link href="/app">Workspace</Link>
      </p>
      <h1 className="brand">{change.title ?? change.eventType}</h1>
      <p className="lede">
        {change.kind} · {change.eventType}
        {change.eventTime ? ` · ${change.eventTime}` : ""}
      </p>

      <section className="panel">
        <h2>Occurrence</h2>
        <p>
          {change.actor ? `By ${change.actor.name}` : "Actor unknown"}
          {change.repository?.name ? ` in ${change.repository.name}` : ""}
        </p>
        {change.url ? (
          <p>
            <a href={change.url} target="_blank" rel="noreferrer">
              Open on GitHub
            </a>
          </p>
        ) : null}
        <p className="meta">{change.sourceEventId}</p>
      </section>

      {snapshot ? (
        <section className="panel" style={{ marginTop: "1.25rem" }}>
          <h2>Current snapshot</h2>
          <p>
            <Link href={`/app/entities/${snapshot.id}`}>
              {snapshot.canonicalName}
            </Link>
            {state ? ` · ${state}` : ""}
          </p>
          <p className="meta">{snapshot.type}</p>
        </section>
      ) : null}

      {change.object && change.object.id !== snapshot?.id ? (
        <section className="panel" style={{ marginTop: "1.25rem" }}>
          <h2>Object</h2>
          <p>
            <Link href={`/app/entities/${change.object.id}`}>
              {change.object.name}
            </Link>
          </p>
        </section>
      ) : null}
    </main>
  );
}
