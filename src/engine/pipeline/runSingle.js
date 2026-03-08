// src/engine/pipeline/runSingle.js
import { parseCsvFile } from "../parser";
import { EVENTS_CONFIG } from "../config/eventsConfig";
import { segmentByDistanceAlongRoad } from "../segmenter";
import { computeGlobalStats } from "../globalStats";
import { buildEventResultsFromSegments } from "../bridge/buildEventResults";
import { buildReport } from "../report/reportBuilder";
import { NORMS } from "../norms";

export async function runSingleFile(file, opts = {}) {
  const { norms = NORMS, eventsConfig = EVENTS_CONFIG } = opts;

  const { rows } = await parseCsvFile(file);
  const globalStats = computeGlobalStats(rows);
  const segments = segmentByDistanceAlongRoad(rows, eventsConfig);
  const eventResults = buildEventResultsFromSegments(segments);
  const report = buildReport(eventResults, globalStats, norms);

  return {
    fileName: file?.name ?? "unknown.csv",
    rowsCount: rows.length,
    globalStats,
    segments,
    eventResults,
    report,
  };
}