"use client";

import { useState, type FormEvent } from "react";
import { MarkdownAnswer } from "@/components/MarkdownAnswer";

type QueryResponse = {
  answer: string;
  confidence: number;
  evidence: Array<{
    id: string;
    title: string | null;
    url: string | null;
    snippet: string | null;
  }>;
  uncertainties: Array<{ code: string; message: string }>;
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
    <form className="query-form" onSubmit={onSubmit}>
      <label className="meta" htmlFor="org-query">
        Ask about indexed GitHub activity
      </label>
      <div className="query-row">
        <input
          id="org-query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className="site-btn" type="submit" disabled={pending}>
          {pending ? "Searching…" : "Ask"}
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {result ? (
        <div className="answer-layout">
          <article className="answer-prose" aria-label="Answer">
            <MarkdownAnswer source={result.answer} />
          </article>
          <aside className="answer-rail" aria-label="Answer details">
            <dl>
              <div>
                <dt>Confidence</dt>
                <dd>{result.confidence.toFixed(2)}</dd>
              </div>
              {result.latencyMs != null ? (
                <div>
                  <dt>Latency</dt>
                  <dd>{result.latencyMs} ms</dd>
                </div>
              ) : null}
              <div>
                <dt>Trace</dt>
                <dd>{result.traceId.slice(0, 8)}</dd>
              </div>
            </dl>
            {(result.uncertainties ?? []).length > 0 ? (
              <>
                <h3>Notes</h3>
                <ul>
                  {(result.uncertainties ?? []).map((item) => (
                    <li key={item.code}>{item.message}</li>
                  ))}
                </ul>
              </>
            ) : null}
            <h3>Evidence</h3>
            {result.evidence.length === 0 ? (
              <p>No source records were attached to this answer.</p>
            ) : (
              <ol>
                {result.evidence.map((item) => (
                  <li key={item.id}>
                    {item.url ? (
                      <a href={item.url} target="_blank" rel="noreferrer">
                        {item.title ?? "Untitled record"}
                      </a>
                    ) : (
                      (item.title ?? "Untitled record")
                    )}
                  </li>
                ))}
              </ol>
            )}
          </aside>
        </div>
      ) : null}
    </form>
  );
}
