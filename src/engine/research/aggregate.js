// src/engine/research/aggregate.js

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function mean(arr) {
  const xs = arr.filter(isNum);
  if (xs.length === 0) return undefined;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sd(arr) {
  const xs = arr.filter(isNum);
  if (xs.length < 2) return undefined;
  const m = mean(xs);
  const v = xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

function median(arr) {
  const xs = arr.filter(isNum).sort((a, b) => a - b);
  if (xs.length === 0) return undefined;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/**
 * reports: Array<{ fileName, report }>
 * options:
 *  - includeInvalid: false면 qc.valid==true인 것만 포함
 */
export function aggregateReports(reports, options = {}) {
  const includeInvalid = options.includeInvalid ?? false;

  const included = reports.filter((r) => includeInvalid || r?.report?.qc?.valid === true);

  // 이벤트별로 metrics 수집
  const byEvent = new Map();

  for (const item of included) {
    const evs = item?.report?.eventSummaries || [];
    for (const ev of evs) {
      const id = ev.eventId;
      if (!byEvent.has(id)) byEvent.set(id, []);
      byEvent.get(id).push(ev);
    }
  }

  // 이벤트별 지표(지금은 responseTimeSec 중심)
  const eventStats = [];
  for (const [eventId, evList] of byEvent.entries()) {
    const eventName = evList[0]?.eventName ?? eventId;

    const responseTimes = evList
      .map((e) => e?.rawMetrics?.responseTimeSec)
      .filter(isNum);

    const noResponseCount = evList.filter((e) => e?.rawMetrics?.noResponse === true).length;

    eventStats.push({
      eventId,
      eventName,
      nFiles: evList.length,
      nResponseTime: responseTimes.length,
      meanResponseTimeSec: mean(responseTimes),
      sdResponseTimeSec: sd(responseTimes),
      medianResponseTimeSec: median(responseTimes),
      noResponseRate: evList.length > 0 ? noResponseCount / evList.length : undefined,
    });
  }

  // 전체(글로벌) 요약
  const avgSpeeds = included.map((r) => r?.report?.globalMetrics?.avgSpeedKph).filter(isNum);

  const global = {
    nFiles: included.length,
    meanAvgSpeedKph: mean(avgSpeeds),
    sdAvgSpeedKph: sd(avgSpeeds),
    medianAvgSpeedKph: median(avgSpeeds),
  };

  // QC 요약
  const qc = {
    totalFiles: reports.length,
    includedFiles: included.length,
    excludedFiles: reports.length - included.length,
  };

  // 정렬(이벤트ID)
  eventStats.sort((a, b) => a.eventId.localeCompare(b.eventId));

  return { qc, global, eventStats };
}