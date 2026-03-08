// src/engine/globalStats.js

function safeNumber(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function computeGlobalStats(rows) {
  const speeds = rows.map((r) => safeNumber(r.speedKph)).filter((v) => v !== undefined);

  const avgSpeedKph =
    speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : undefined;

  const speedOverCount = rows.filter((r) => r.speedOver === true).length;
  const speedOverRatio = rows.length > 0 ? speedOverCount / rows.length : undefined;

  return {
    totalRows: rows.length,
    avgSpeedKph,
    speedOverRatio,
    speedOverCount,
  };
}