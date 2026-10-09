"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  fetchSyncJob,
  selectRepositories,
  startRepositorySync,
  type InstallationSummary,
  type RepositorySummary,
  type SyncJobSummary,
} from "@/lib/api";

type Props = {
  installation: InstallationSummary;
  repositories: RepositorySummary[];
};

export function RepositoryPicker({ installation, repositories }: Props) {
  const initiallySelected = useMemo(
    () =>
      new Set(
        repositories
          .filter((repo) => repo.selected)
          .map((repo) => repo.githubRepositoryId),
      ),
    [repositories],
  );
  const [selected, setSelected] = useState<Set<number>>(initiallySelected);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [syncJob, setSyncJob] = useState<SyncJobSummary | null>(null);
  const [syncingRepoId, setSyncingRepoId] = useState<string | null>(null);

  useEffect(() => {
    if (!syncJob || syncJob.status === "completed" || syncJob.status === "failed") {
      return;
    }

    const timer = setInterval(() => {
      void fetchSyncJob(syncJob.id)
        .then((data) => setSyncJob(data.job))
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : "Sync status failed");
        });
    }, 1500);

    return () => clearInterval(timer);
  }, [syncJob]);

  function toggle(id: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function onSave() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        await selectRepositories(installation.id, [...selected]);
        setMessage(
          selected.size === 1
            ? "Saved 1 selected repository."
            : `Saved ${selected.size} selected repositories.`,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  function onSync(repositoryId: string) {
    setError(null);
    setMessage(null);
    setSyncingRepoId(repositoryId);
    startTransition(async () => {
      try {
        const data = await startRepositorySync(installation.id, repositoryId);
        setSyncJob(data.job);
        setMessage(`Sync queued (${data.job.id.slice(0, 8)}…)`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Sync failed");
      } finally {
        setSyncingRepoId(null);
      }
    });
  }

  if (repositories.length === 0) {
    return <p className="empty">No repositories accessible to this installation.</p>;
  }

  return (
    <div>
      <ul className="record-list">
        {repositories.map((repo) => {
          const isSelected = selected.has(repo.githubRepositoryId);
          return (
            <li className="record repo-row" key={repo.id}>
              <label>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(repo.githubRepositoryId)}
                />
                <span className="repo-name">{repo.fullName}</span>
              </label>
              <span className="record-kind">
                {isSelected ? "selected" : repo.visibility ?? "repo"}
              </span>
              {isSelected ? (
                <button
                  type="button"
                  className="site-btn site-btn-quiet"
                  disabled={pending || syncingRepoId === repo.id}
                  onClick={() => onSync(repo.id)}
                >
                  {syncingRepoId === repo.id ? "Queueing…" : "Start sync"}
                </button>
              ) : (
                <span />
              )}
            </li>
          );
        })}
      </ul>
      <div className="query-row picker-actions">
        <button
          type="button"
          className="site-btn"
          disabled={pending || selected.size === 0}
          onClick={onSave}
        >
          {pending && !syncingRepoId ? "Saving…" : "Save selection"}
        </button>
      </div>
      {message ? <p className="meta">{message}</p> : null}
      {syncJob ? (
        <p className="meta">
          Sync <code>{syncJob.id.slice(0, 8)}</code>: {syncJob.status}
          {syncJob.processedCount > 0
            ? ` · ${syncJob.processedCount} events`
            : ""}
          {syncJob.error ? ` · ${syncJob.error}` : ""}
        </p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
