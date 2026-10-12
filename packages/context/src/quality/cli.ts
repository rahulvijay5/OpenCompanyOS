import { runContextQualityEvaluation, writeEvalReport } from "./run.js";

const { report, exitCode } = await runContextQualityEvaluation();
const file = await writeEvalReport(report);
console.log(
  JSON.stringify({
    file,
    exitCode,
    database: report.database.status,
    contextPackage: {
      total: report.contextPackage.total,
      passed: report.contextPackage.passed,
      failed: report.contextPackage.failed,
      skipped: report.contextPackage.skipped,
      inconclusive: report.contextPackage.inconclusive,
    },
    llmCalls: report.llmCalls,
  }),
);
process.exit(exitCode);
