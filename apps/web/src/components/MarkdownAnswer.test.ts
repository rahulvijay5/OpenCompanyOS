import { describe, expect, it } from "vitest";
import { prepareAnswerMarkdown } from "./MarkdownAnswer";

describe("prepareAnswerMarkdown", () => {
  it("turns an inline dash list into markdown and drops evidence ids", () => {
    const raw =
      "This week, several activities occurred: - **Merged Pull Requests:** A pull request was merged (429d98cf-cf68-4ad9-a00b-d60744d9e803). - **Opened Issues:** An issue was opened.";
    const prepared = prepareAnswerMarkdown(raw);
    expect(prepared).not.toMatch(/429d98cf/);
    expect(prepared).toContain("\n- **Merged Pull Requests:**");
    expect(prepared).toContain("\n- **Opened Issues:**");
  });

  it("unwraps a markdown fence", () => {
    expect(prepareAnswerMarkdown("```markdown\n## Week\n\n- One\n```")).toBe(
      "## Week\n\n- One",
    );
  });
});
