export type RetrievalScore = {
  hits: string[];
  missing: string[];
  extras: string[];
  recall: number | null;
  precision: number | null;
  claimSupport: "supports" | "does_not_support" | "mixed" | "abstained";
  abstained: boolean;
};

/** Four separate readings of one retrieved id list. Recall is null for a verified empty set. */
export function scoreRetrieved(relevant: string[], retrieved: string[]): RetrievalScore {
  const relevantSet = new Set(relevant);
  const hits = relevant.filter((id) => retrieved.includes(id));
  const extras = retrieved.filter((id) => !relevantSet.has(id));
  const recall = relevant.length === 0 ? null : hits.length / relevant.length;
  const precision = retrieved.length === 0 ? null : hits.length / retrieved.length;
  let claimSupport: RetrievalScore["claimSupport"];
  if (relevant.length === 0) {
    claimSupport = retrieved.length === 0 ? "abstained" : "does_not_support";
  } else if (hits.length === 0) {
    claimSupport = "does_not_support";
  } else if (extras.length > 0) {
    claimSupport = "mixed";
  } else {
    claimSupport = hits.length === relevant.length ? "supports" : "mixed";
  }
  return {
    hits,
    missing: relevant.filter((id) => !retrieved.includes(id)),
    extras,
    recall,
    precision,
    claimSupport,
    abstained: relevant.length === 0 && retrieved.length === 0,
  };
}
