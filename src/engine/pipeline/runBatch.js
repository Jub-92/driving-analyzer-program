// src/engine/pipeline/runBatch.js
import { runSingleFile } from "./runSingle";
import { aggregateReports } from "../research/aggregate";

export async function runBatchFiles(files, opts = {}) {
  const list = Array.from(files || []);
  const results = [];

  for (const f of list) {
    try {
      const one = await runSingleFile(f, opts);
      results.push({ fileName: one.fileName, report: one.report, ok: true });
    } catch (err) {
      console.error("Batch item failed:", f?.name, err);
      results.push({
        fileName: f?.name ?? "unknown.csv",
        ok: false,
        error: String(err?.message ?? err),
      });
    }
  }

  const aggregated = aggregateReports(
    results.filter((r) => r.ok),
    { includeInvalid: opts.includeInvalid ?? false }
  );

  return { results, aggregated };
}