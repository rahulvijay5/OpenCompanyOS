export type EntityDraft = {
  type: string;
  sourceId: string;
  canonicalName: string;
  description: string | null;
  metadata: Record<string, unknown>;
  alias: string | null;
};

export type RelationshipDraft = {
  source: { type: string; sourceId: string };
  relationshipType: string;
  target: { type: string; sourceId: string };
};

export type CanonicalProjection = {
  entities: EntityDraft[];
  relationships: RelationshipDraft[];
  actor: { type: string; sourceId: string } | null;
  object: { type: string; sourceId: string } | null;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function person(login: string): EntityDraft {
  return {
    type: "Person",
    sourceId: `github:user:${login}`,
    canonicalName: login,
    description: null,
    metadata: { login },
    alias: login,
  };
}

function repository(fullName: string): EntityDraft {
  return {
    type: "Repository",
    sourceId: `github:repo:${fullName}`,
    canonicalName: fullName,
    description: null,
    metadata: { fullName },
    alias: null,
  };
}

function ref(type: string, sourceId: string) {
  return { type, sourceId };
}

function stableSourceId(
  prefix: "github:issue" | "github:pull_request",
  sourceEventId: string,
  payload: Record<string, unknown>,
): string {
  if (typeof payload.id === "number") {
    return `${prefix}:${payload.id}`;
  }
  const match = new RegExp(`^(${prefix}:\\d+)`).exec(sourceEventId);
  return match?.[1] ?? sourceEventId;
}

/**
 * Projects a stored GitHub event into canonical entities and relationships.
 * Identity keys match sync/webhook source ids so reprocessing is idempotent.
 */
export function projectCanonicalGraph(input: {
  sourceEventId: string;
  payload: Record<string, unknown>;
}): CanonicalProjection {
  const payload = input.payload;
  const fullName = asString(payload.fullName);
  const entities: EntityDraft[] = [];
  const relationships: RelationshipDraft[] = [];
  let actor: CanonicalProjection["actor"] = null;
  let object: CanonicalProjection["object"] = null;

  const repo = fullName ? repository(fullName) : null;
  if (repo) {
    entities.push(repo);
  }

  if (input.sourceEventId.startsWith("github:issue:")) {
    const title = asString(payload.title) ?? input.sourceEventId;
    const number = payload.number;
    const issue: EntityDraft = {
      type: "Issue",
      sourceId: stableSourceId("github:issue", input.sourceEventId, payload),
      canonicalName:
        typeof number === "number" ? `#${number} ${title}` : title,
      description: asString(payload.body),
      metadata: {
        number: payload.number ?? null,
        state: payload.state ?? null,
        htmlUrl: payload.htmlUrl ?? null,
        fullName,
      },
      alias: null,
    };
    entities.push(issue);
    object = ref(issue.type, issue.sourceId);

    const login = asString(payload.userLogin);
    if (login) {
      const author = person(login);
      entities.push(author);
      actor = ref(author.type, author.sourceId);
      relationships.push({
        source: actor,
        relationshipType: "AUTHORED",
        target: object,
      });
    }
    if (repo && object) {
      relationships.push({
        source: object,
        relationshipType: "BELONGS_TO",
        target: ref(repo.type, repo.sourceId),
      });
    }
    return { entities, relationships, actor, object };
  }

  if (input.sourceEventId.startsWith("github:pull_request:")) {
    const title = asString(payload.title) ?? input.sourceEventId;
    const number = payload.number;
    const pr: EntityDraft = {
      type: "PullRequest",
      sourceId: stableSourceId("github:pull_request", input.sourceEventId, payload),
      canonicalName:
        typeof number === "number" ? `#${number} ${title}` : title,
      description: asString(payload.body),
      metadata: {
        number: payload.number ?? null,
        state: payload.state ?? null,
        merged: payload.merged ?? null,
        htmlUrl: payload.htmlUrl ?? null,
        fullName,
      },
      alias: null,
    };
    entities.push(pr);
    object = ref(pr.type, pr.sourceId);

    const login = asString(payload.userLogin);
    if (login) {
      const author = person(login);
      entities.push(author);
      actor = ref(author.type, author.sourceId);
      relationships.push({
        source: actor,
        relationshipType: "AUTHORED",
        target: object,
      });
    }
    if (repo && object) {
      relationships.push({
        source: object,
        relationshipType: "BELONGS_TO",
        target: ref(repo.type, repo.sourceId),
      });
    }
    return { entities, relationships, actor, object };
  }

  if (input.sourceEventId.startsWith("github:commit:")) {
    const message = asString(payload.message);
    const sha = asString(payload.sha) ?? input.sourceEventId.replace("github:commit:", "");
    const commit: EntityDraft = {
      type: "Commit",
      sourceId: input.sourceEventId,
      canonicalName: message?.split("\n")[0]?.slice(0, 120) || sha.slice(0, 12),
      description: message,
      metadata: {
        sha,
        htmlUrl: payload.htmlUrl ?? null,
        fullName,
      },
      alias: null,
    };
    entities.push(commit);
    object = ref(commit.type, commit.sourceId);

    const login = asString(payload.authorLogin) ?? asString(payload.authorName);
    if (login) {
      const author = person(login);
      entities.push(author);
      actor = ref(author.type, author.sourceId);
      relationships.push({
        source: actor,
        relationshipType: "AUTHORED",
        target: object,
      });
    }
    if (repo && object) {
      relationships.push({
        source: object,
        relationshipType: "MODIFIES",
        target: ref(repo.type, repo.sourceId),
      });
    }
    return { entities, relationships, actor, object };
  }

  if (input.sourceEventId.startsWith("github:issue_comment:")) {
    const body = asString(payload.body);
    const comment: EntityDraft = {
      type: "Comment",
      sourceId: input.sourceEventId,
      canonicalName: body?.slice(0, 80) || input.sourceEventId,
      description: body,
      metadata: {
        htmlUrl: payload.htmlUrl ?? null,
        issueNumber: payload.issueNumber ?? null,
        fullName,
      },
      alias: null,
    };
    entities.push(comment);
    object = ref(comment.type, comment.sourceId);

    const login = asString(payload.userLogin);
    if (login) {
      const author = person(login);
      entities.push(author);
      actor = ref(author.type, author.sourceId);
      relationships.push({
        source: actor,
        relationshipType: "AUTHORED",
        target: object,
      });
    }
    if (repo && object) {
      relationships.push({
        source: object,
        relationshipType: "BELONGS_TO",
        target: ref(repo.type, repo.sourceId),
      });
    }
    if (typeof payload.pullRequestId === "number" && typeof payload.issueId !== "number" && object) {
      const pullSourceId = `github:pull_request:${payload.pullRequestId}`;
      entities.push({
        type: "PullRequest",
        sourceId: pullSourceId,
        canonicalName:
          typeof payload.pullRequestNumber === "number"
            ? `#${payload.pullRequestNumber}`
            : typeof payload.issueNumber === "number"
              ? `#${payload.issueNumber}`
              : pullSourceId,
        description: null,
        metadata: {
          number: payload.pullRequestNumber ?? payload.issueNumber ?? null,
          fullName,
        },
        alias: null,
      });
      relationships.push({
        source: object,
        relationshipType: "DISCUSSES",
        target: ref("PullRequest", pullSourceId),
      });
    } else if (typeof payload.issueId === "number" && object) {
      const issueSourceId = `github:issue:${payload.issueId}`;
      entities.push({
        type: "Issue",
        sourceId: issueSourceId,
        canonicalName:
          typeof payload.issueNumber === "number"
            ? `#${payload.issueNumber}`
            : issueSourceId,
        description: null,
        metadata: { number: payload.issueNumber ?? null, fullName },
        alias: null,
      });
      relationships.push({
        source: object,
        relationshipType: "DISCUSSES",
        target: ref("Issue", issueSourceId),
      });
    }
    return { entities, relationships, actor, object };
  }

  if (input.sourceEventId.startsWith("github:pull_request_review:")) {
    const login = asString(payload.userLogin);
    if (typeof payload.pullRequestId === "number") {
      const prSourceId = `github:pull_request:${payload.pullRequestId}`;
      entities.push({
        type: "PullRequest",
        sourceId: prSourceId,
        canonicalName:
          typeof payload.pullRequestNumber === "number"
            ? `#${payload.pullRequestNumber}`
            : prSourceId,
        description: null,
        metadata: { number: payload.pullRequestNumber ?? null, fullName },
        alias: null,
      });
      object = ref("PullRequest", prSourceId);
      if (repo) {
        relationships.push({
          source: object,
          relationshipType: "BELONGS_TO",
          target: ref(repo.type, repo.sourceId),
        });
      }
    }
    if (login) {
      const reviewer = person(login);
      entities.push(reviewer);
      actor = ref(reviewer.type, reviewer.sourceId);
      if (object) {
        relationships.push({
          source: actor,
          relationshipType: "REVIEWED",
          target: object,
        });
      }
    }
    return { entities, relationships, actor, object };
  }

  return { entities, relationships, actor, object };
}
