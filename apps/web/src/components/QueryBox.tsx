"use client";

import { useState, type FormEvent } from "react";

type QueryResponse = {
  answer: string;
  confidence: number;
  evidence: Array<{ title: string | null; url: string | null; snippet: string | null }>;
  entities: Array<{ id: string; type: string; canonicalName: string }>;
  traceId: string;
  latencyMs?: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function QueryBox() {
  const [query, setQuery] = useState("What changed this week?");
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/api/v1/query`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (!response.ok) {
        throw new Error(`Query failed (${response.status})`);
      }
      setResult((await response.json()) as QueryResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Query failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <label className="meta" htmlFor="org-query">
        Ask about indexed GitHub activity
      </label>
      <div className="actions">
        <input
          id="org-query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          style={{
            flex: 1,
            minWidth: "16rem",
            background: "transparent",
            color: "inherit",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "0.7rem 0.8rem",
            font: "inherit",
          }}
        />
        <button className="button button-primary" type="submit" disabled={pending}>
          {pending ? "Searching…" : "Ask"}
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {result ? (
        <div>
          <p>{result.answer}</p>
          <p className="meta">
            confidence {result.confidence.toFixed(2)}
            {result.latencyMs != null ? ` · ${result.latencyMs}ms` : ""} · trace{" "}
            {result.traceId.slice(0, 8)}
          </p>
          {result.evidence.length > 0 ? (
            <ul className="repo-list">
              {result.evidence.map((item) => (
                <li className="repo-item" key={`${item.url ?? ""}-${item.title ?? ""}`}>
                  <span className="badge">evidence</span>
                  <span className="repo-name">{item.title ?? "untitled"}</span>
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noreferrer">
                      open
                    </a>
                  ) : (
                    <span />
                  )}
                  <span />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
