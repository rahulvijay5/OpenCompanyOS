import { repositories, type Database } from "@opencompanyos/db";
import { and, eq } from "drizzle-orm";

export type SelectedRepository = {
  id: string;
  fullName: string;
};

export type RepositoryScope = {
  repositoryIds: string[];
  rejected: string[];
  repositories: SelectedRepository[];
};

export function intersectRepositoryScope(
  selected: SelectedRepository[],
  requested: readonly string[] | null,
): RepositoryScope {
  if (!requested || requested.length === 0) {
    return {
      repositoryIds: selected.map((repo) => repo.id),
      rejected: [],
      repositories: selected,
    };
  }

  const byId = new Map(selected.map((repo) => [repo.id, repo]));
  const repositoriesInScope: SelectedRepository[] = [];
  const rejected: string[] = [];
  for (const id of requested) {
    const repo = byId.get(id);
    if (repo) {
      repositoriesInScope.push(repo);
    } else {
      rejected.push(id);
    }
  }

  return {
    repositoryIds: repositoriesInScope.map((repo) => repo.id),
    rejected,
    repositories: repositoriesInScope,
  };
}

export async function resolveScope(
  db: Database,
  tenantId: string,
  requested: readonly string[] | null,
): Promise<RepositoryScope> {
  const selected = await db.query.repositories.findMany({
    where: and(
      eq(repositories.tenantId, tenantId),
      eq(repositories.selected, true),
    ),
  });
  return intersectRepositoryScope(
    selected.map((repo) => ({ id: repo.id, fullName: repo.fullName })),
    requested,
  );
}
