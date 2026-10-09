export type EvidenceRow = {
  title: string | null;
  url: string | null;
  snippet: string | null;
};

export type EvalExpectation = {
  evidenceIncludes?: string[];
  answerIncludes?: string[];
  answerIncludesAny?: string[];
  answerExcludes?: string[];
};

export type QueryScore = {
  passed: boolean;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
};

function haystack(evidence: EvidenceRow[]): string {
  return evidence
    .map((row) => [row.title, row.url, row.snippet].filter(Boolean).join(" "))
    .join("\n")
    .toLowerCase();
}

function includes(text: string, needle: string): boolean {
  return text.toLowerCase().includes(needle.toLowerCase());
}

export function scoreQueryCase(input: {
  answer: string;
  evidence: EvidenceRow[];
  expect: EvalExpectation;
}): QueryScore {
  const checks: QueryScore["checks"] = [];
  const evidenceText = haystack(input.evidence);

  for (const needle of input.expect.evidenceIncludes ?? []) {
    const passed = includes(evidenceText, needle);
    checks.push({
      name: `evidence includes ${needle}`,
      passed,
      detail: passed ? "matched" : "missing from evidence titles, urls, and snippets",
    });
  }

  for (const needle of input.expect.answerIncludes ?? []) {
    const passed = includes(input.answer, needle);
    checks.push({
      name: `answer includes ${needle}`,
      passed,
      detail: passed ? "matched" : "missing from the answer",
    });
  }

  const anyOf = input.expect.answerIncludesAny ?? [];
  if (anyOf.length > 0) {
    const passed = anyOf.some((needle) => includes(input.answer, needle));
    checks.push({
      name: `answer includes one of ${anyOf.join(", ")}`,
      passed,
      detail: passed ? "matched" : "none of the expected phrases were in the answer",
    });
  }

  for (const needle of input.expect.answerExcludes ?? []) {
    const passed = !includes(input.answer, needle);
    checks.push({
      name: `answer excludes ${needle}`,
      passed,
      detail: passed ? "absent" : "unexpected phrase was in the answer",
    });
  }

  return {
    passed: checks.every((check) => check.passed),
    checks,
  };
}
