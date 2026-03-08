// src/engine/bridge/buildEventResults.js
import { computeBasicIndicatorsForSegment } from "../indicators/basicIndicators";
import { buildRedFlags } from "../redflags/redflagBuilder";

export function buildEventResultsFromSegments(segments) {
  // eventId별로 windows + rows를 합친다
  const map = new Map();

  for (const seg of segments) {
    const key = seg.eventId;

    if (!map.has(key)) {
      map.set(key, {
        eventId: seg.eventId,
        eventName: seg.eventName,
        rows: [],         // ✅ rows를 합칠 것
        rowsCount: 0,
        empty: true,
        windows: [],
        indicators: null, // ✅ Step4
        redFlags: [],     // ✅ Step4
        notes: [],
      });
    }

    const item = map.get(key);

    item.windows.push({
      windowIndex: seg.windowIndex,
      window: seg.window,
      isUnset: seg.isUnset,
      rowCount: seg.stats?.rowCount ?? 0,
      minDistanceAlongRoad: seg.stats?.minDistanceAlongRoad,
      maxDistanceAlongRoad: seg.stats?.maxDistanceAlongRoad,
    });

    // windows 미설정이면 rows는 비어있게 유지
    if (!seg.isUnset && Array.isArray(seg.rows) && seg.rows.length > 0) {
      item.rows.push(...seg.rows);
    }

    const add = seg.stats?.rowCount ?? 0;
    item.rowsCount += add;
    item.empty = item.rowsCount <= 0;
  }

  // 이벤트별 지표/레드플래그 생성
  const out = [];
  for (const item of map.values()) {
    const indicators = computeBasicIndicatorsForSegment(item.rows, item.eventId);
    const redFlags = buildRedFlags({
      eventId: item.eventId,
      eventName: item.eventName,
      rows: item.rows,
      indicators,
    });

    out.push({
      eventId: item.eventId,
      eventName: item.eventName,
      rowsCount: item.rowsCount,
      empty: item.empty,
      windows: item.windows,
      indicators, // ✅
      redFlags,   // ✅
      notes: [],
    });
  }

  return out;
}