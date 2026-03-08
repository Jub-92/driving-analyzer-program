// src/engine/segmenter.js

/**
 * distanceAlongRoad 기반으로 자르되,
 * windows가 (0~0) 미설정이면 간단한 자동 탐지로 windows를 생성한다.
 *
 * 자동 탐지(1차 버전):
 * - schoolZone: speedLimit <= 30 인 구간
 * - jaywalkingPedestrian: pedestriansNumber > 0 인 구간
 * - leadVehicleHardBrake: ttcToFrontVehicle >0 && <= 2.0 인 구간
 * - unprotectedLeftTurn / channelizedRightTurn: scenarioMessage 키워드 기반(있을 때만)
 *
 * 탐지 후 start/end는 distanceAlongRoad로 설정(패딩 포함).
 */

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function s(v) {
  return (v ?? "").toString().toLowerCase();
}

function clampWindowByDistance(rows, startIdx, endIdx, padMeters = 30) {
  const d0 = rows[startIdx]?.distanceAlongRoad;
  const d1 = rows[endIdx]?.distanceAlongRoad;

  if (!isNum(d0) || !isNum(d1)) return [];

  const start = Math.max(0, Math.min(d0, d1) - padMeters);
  const end = Math.max(d0, d1) + padMeters;

  if (start === 0 && end === 0) return [];
  return [{ start, end, _auto: true }];
}

function findFirstLastIndex(rows, predicate) {
  let first = -1;
  let last = -1;
  for (let i = 0; i < rows.length; i++) {
    if (predicate(rows[i], i)) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return null;
  return { first, last };
}

function autoDetectEventWindowsSimple(rows, eventId) {
  if (!rows || rows.length === 0) return [];

  switch (eventId) {
    case "schoolZone": {
      const hit = findFirstLastIndex(rows, (r) => isNum(r.speedLimit) && r.speedLimit > 0 && r.speedLimit <= 30);
      if (!hit) return [];
      return clampWindowByDistance(rows, hit.first, hit.last, 50);
    }

    case "jaywalkingPedestrian": {
      const hit = findFirstLastIndex(rows, (r) => isNum(r.pedestriansNumber) && r.pedestriansNumber > 0);
      if (!hit) return [];
      return clampWindowByDistance(rows, hit.first, hit.last, 40);
    }

    case "leadVehicleHardBrake": {
      const TTC_CRIT = 2.0;
      const hit = findFirstLastIndex(
        rows,
        (r) => isNum(r.ttcToFrontVehicle) && r.ttcToFrontVehicle > 0 && r.ttcToFrontVehicle <= TTC_CRIT
      );
      if (!hit) return [];
      return clampWindowByDistance(rows, hit.first, hit.last, 40);
    }

    case "unprotectedLeftTurn": {
      const hit = findFirstLastIndex(rows, (r) => {
        const msg = s(r.scenarioMessage);
        return msg.includes("ult") || msg.includes("left") || msg.includes("좌회전");
      });
      if (!hit) return [];
      return clampWindowByDistance(rows, hit.first, hit.last, 60);
    }

    case "channelizedRightTurn": {
      const hit = findFirstLastIndex(rows, (r) => {
        const msg = s(r.scenarioMessage);
        return msg.includes("channel") || msg.includes("right") || msg.includes("우회전") || msg.includes("도류");
      });
      if (!hit) return [];
      return clampWindowByDistance(rows, hit.first, hit.last, 60);
    }

    default:
      return [];
  }
}

/**
 * distanceAlongRoad 기반 segment 생성
 */
export function segmentByDistanceAlongRoad(rows, eventsConfig) {
  const segments = [];

  for (const ev of eventsConfig) {
    // 1) 설정된 windows가 있으면 그걸 사용
    const configuredWindows = (ev.windows || []).filter((w) => !(w.start === 0 && w.end === 0));

    // 2) 없으면 간단 자동탐지
    const windowsToUse = configuredWindows.length > 0 ? configuredWindows : autoDetectEventWindowsSimple(rows, ev.id);

    // 3) 자동탐지조차 못하면 빈 window 1개(QC용)
    const finalWindows = windowsToUse.length > 0 ? windowsToUse : [{ start: 0, end: 0, _auto: false }];

    for (let i = 0; i < finalWindows.length; i++) {
      const w = finalWindows[i];
      const isUnset = w.start === 0 && w.end === 0;

      const slice = isUnset
        ? []
        : rows.filter((r) => {
            const d = r.distanceAlongRoad;
            return isNum(d) && d >= w.start && d <= w.end;
          });

      const distances = slice.map((r) => r.distanceAlongRoad).filter(isNum);

      const minD = distances.length ? Math.min(...distances) : undefined;
      const maxD = distances.length ? Math.max(...distances) : undefined;

      segments.push({
        eventId: ev.id,
        eventName: ev.name,
        windowIndex: i,
        window: w,
        isUnset,
        rows: slice,
        stats: {
          rowCount: slice.length,
          minDistanceAlongRoad: minD,
          maxDistanceAlongRoad: maxD,
        },
      });
    }
  }

  return segments;
}