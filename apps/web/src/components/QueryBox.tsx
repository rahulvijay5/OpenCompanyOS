"use client";

import { useState, type FormEvent } from "react";
import { MarkdownAnswer } from "@/components/MarkdownAnswer";
import {
  coverageMessage,
  evidenceRow,
  intervalLabel,
  resultAfterAttempt,
  snapshotRow,
  uncertaintyMessage,
  type PanelEvidence,
  type PanelResponse,
} from "@/components/evidence-panel";
import { emptyQueryMessage } from "@/components/query-submit";

type QueryResponse = PanelResponse & {
  answer: string;
  confidence: number;
  evidence: PanelEvidence[];
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
    const validation = emptyQueryMessage(query);
    if (validation) {
      setPending(false);
      setError(validation);
      setResult(null);
      return;
    }
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`${API_URL}/api/v1/query`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `Query failed (${response.status})`);
      }
      const body = (await response.json()) as QueryResponse;
      setResult(resultAfterAttempt(false, body));
    } catch (err) {
      setResult(resultAfterAttempt(true, null));
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
          <aside className="answer-rail" aria-label="Why am I seeing this?">
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
            <h3>Why am I seeing this?</h3>
            {intervalLabel(result.context?.interval) ? (
              <p>{intervalLabel(result.context?.interval)}</p>
            ) : null}
            <p>
              {coverageMessage(result.context?.coverage?.state, {
                hasEvidence: result.evidence.length > 0,
              })}
            </p>
            {(result.uncertainties ?? []).length > 0 ? (
              <ul>
                {(result.uncertainties ?? []).map((item) => (
                  <li key={item.code}>{uncertaintyMessage(item.code)}</li>
                ))}
              </ul>
            ) : null}
            <h3>Evidence</h3>
            {result.evidence.length === 0 ? (
              <p>No source records were attached to this answer.</p>
            ) : (
              <ol>
                {result.evidence.map((item) => {
                  const row = evidenceRow(item);
                  return (
                    <li key={row.id}>
                      {row.href ? (
                        <a href={row.href} target="_blank" rel="noreferrer">
                          {row.title}
                        </a>
                      ) : (
                        row.title
                      )}
                      <span className="record-meta">
                        {[row.recordKindLabel, row.eventTimeLabel, row.sourceLabel, row.repositoryLabel]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      <span className="record-meta">{row.inclusionLabel}</span>
                    </li>
                  );
                })}
              </ol>
            )}
            {(result.context?.currentState ?? []).length > 0 ? (
              <>
                <h3>Current snapshots</h3>
                <p>These are stored current records. They are not changes during the interval.</p>
                <ol>
                  {(result.context?.currentState ?? []).map((item) => {
                    const row = snapshotRow(item);
                    return (
                      <li key={row.id}>
                        {row.title}
                        <span className="record-meta">
                          {[row.recordKindLabel, row.eventTimeLabel, row.sourceLabel].filter(Boolean).join(" · ")}
                        </span>
                        <span className="record-meta">{row.inclusionLabel}</span>
                      </li>
                    );
                  })}
                </ol>
              </>
            ) : null}
          </aside>
        </div>
      ) : null}
    </form>
  );
}
