// src/engine/segmenter_auto.js

// 이벤트 ID는 eventsConfig.js의 id와 동일해야 함
const EVENT_IDS = {
  schoolZone: "schoolZone",
  unprotectedLeftTurn: "unprotectedLeftTurn",
  jaywalkingPedestrian: "jaywalkingPedestrian",
  channelizedRightTurn: "channelizedRightTurn",
  leadVehicleHardBrake: "leadVehicleHardBrake",
};

function s(v) {
  return (v ?? "").toString().toLowerCase();
}

/**
 * 연속된 true 구간을 distanceAlongRoad start/end window로 변환
 */
function booleanMaskToWindows(rows, predicate, opts = {}) {
  const minLen = opts.minLen ?? 10; // 최소 연속 길이(샘플 수)
  const windows = [];

  let startIdx = null;

  for (let i = 0; i < rows.length; i++) {
    const hit = predicate(rows[i], i);

    if (hit && startIdx === null) startIdx = i;
    if (!hit && startIdx !== null) {
      const endIdx = i - 1;
      const len = endIdx - startIdx + 1;
      if (len >= minLen) {
        const startD = rows[startIdx]?.distanceAlongRoad;
        const endD = rows[endIdx]?.distanceAlongRoad;
        if (typeof startD === "number" && typeof endD === "number") {
          windows.push({ start: Math.min(startD, endD), end: Math.max(startD, endD), _auto: true });
        }
      }
      startIdx = null;
    }
  }

  // tail
  if (startIdx !== null) {
    const endIdx = rows.length - 1;
    const len = endIdx - startIdx + 1;
    if (len >= minLen) {
      const startD = rows[startIdx]?.distanceAlongRoad;
      const endD = rows[endIdx]?.distanceAlongRoad;
      if (typeof startD === "number" && typeof endD === "number") {
        windows.push({ start: Math.min(startD, endD), end: Math.max(startD, endD), _auto: true });
      }
    }
  }

  // 너무 잘게 여러 개 나오면 상위 1개만(일단 기능 완성 우선)
  if (windows.length > 1) {
    windows.sort((a, b) => (b.end - b.start) - (a.end - a.start));
    return [windows[0]];
  }

  return windows;
}

export function autoDetectEventWindows(rows, eventId) {
  if (!rows || rows.length === 0) return [];

  switch (eventId) {
    // 1) 무단횡단 보행자: pedestriansNumber > 0 또는 scenarioMessage에 pedestrian
    case EVENT_IDS.jaywalkingPedestrian: {
      return booleanMaskToWindows(
        rows,
        (r) => (typeof r.pedestriansNumber === "number" && r.pedestriansNumber > 0) || s(r.scenarioMessage).includes("pedestrian"),
        { minLen: 5 }
      );
    }

    // 2) 전방차량 급정거: TTC가 갑자기 낮아짐(임시) 또는 scenarioMessage
    case EVENT_IDS.leadVehicleHardBrake: {
      return booleanMaskToWindows(
        rows,
        (r) => (typeof r.ttcToFrontVehicle === "number" && r.ttcToFrontVehicle > 0 && r.ttcToFrontVehicle <= 2.0) || s(r.scenarioMessage).includes("brake"),
        { minLen: 5 }
      );
    }

    // 3) 어린이 보호구역: speedLimit가 낮아짐(예: <=30) 또는 scenarioMessage에 school
    case EVENT_IDS.schoolZone: {
      return booleanMaskToWindows(
        rows,
        (r) => (typeof r.speedLimit === "number" && r.speedLimit > 0 && r.speedLimit <= 30) || s(r.scenarioMessage).includes("school"),
        { minLen: 10 }
      );
    }

    // 4) 비보호 좌회전 / 5) 도류화 우회전
    // 시나리오 메시지 기반으로만 최소 구현(나중에 distance로 대체)
    case EVENT_IDS.unprotectedLeftTurn: {
      return booleanMaskToWindows(
        rows,
        (r) => s(r.scenarioMessage).includes("left") || s(r.scenarioMessage).includes("ult"),
        { minLen: 5 }
      );
    }

    case EVENT_IDS.channelizedRightTurn: {
      return booleanMaskToWindows(
        rows,
        (r) => s(r.scenarioMessage).includes("right") || s(r.scenarioMessage).includes("channel"),
        { minLen: 5 }
      );
    }

    default:
      return [];
  }
} 