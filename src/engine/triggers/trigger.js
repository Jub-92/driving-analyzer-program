// src/engine/triggers/trigger.js

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function getTime(r) {
  return num(r?.scenarioTime ?? r?.time);
}

function s(v) {
  return (v ?? "").toString().toLowerCase();
}

/**
 * t0 찾기: eventId 별로 "자극 발생" 시점을 찾아 index+time 반환
 * - 찾지 못하면 null
 */
export function findStimulusT0(rows, eventId) {
  if (!rows || rows.length === 0) return null;

  // Helper: 변화(0 -> >0, 큰 변화 등) 첫 인덱스 찾기
  const firstIndex = (predicate) => {
    for (let i = 0; i < rows.length; i++) {
      if (predicate(rows[i], i)) return i;
    }
    return -1;
  };

  switch (eventId) {
    // E3 무단횡단 보행자: pedestriansNumber 0->>0 또는 scenarioMessage에 pedestrian
    case "jaywalkingPedestrian": {
      let prev = num(rows[0]?.pedestriansNumber) ?? 0;
      const idx = firstIndex((r) => {
        const cur = num(r.pedestriansNumber) ?? 0;
        const msg = s(r.scenarioMessage);
        const hit = (prev <= 0 && cur > 0) || msg.includes("pedestrian");
        prev = cur;
        return hit;
      });
      if (idx >= 0) return { index: idx, time: getTime(rows[idx]), source: "pedestriansNumber|message" };
      return null;
    }

    // E5 전방차량 급정거: TTC가 임계값 이하로 들어오는 첫 시점(또는 brake 키워드)
    case "leadVehicleHardBrake": {
      const TTC_THRESH = 2.0;
      const idx = firstIndex((r) => {
        const ttc = num(r.ttcToFrontVehicle);
        const msg = s(r.scenarioMessage);
        return (ttc !== undefined && ttc > 0 && ttc <= TTC_THRESH) || msg.includes("brake");
      });
      if (idx >= 0) return { index: idx, time: getTime(rows[idx]), source: "TTC<=2.0|message" };
      return null;
    }

    // E1 보호구역: speedLimit가 <=30 진입(또는 school 키워드)
    case "schoolZone": {
      const idx = firstIndex((r) => {
        const lim = num(r.speedLimit);
        const msg = s(r.scenarioMessage);
        return (lim !== undefined && lim > 0 && lim <= 30) || msg.includes("school");
      });
      if (idx >= 0) return { index: idx, time: getTime(rows[idx]), source: "speedLimit<=30|message" };
      return null;
    }

    // E2 ULT / E4 도류화 우회전: 일단 scenarioMessage 기반(추후 교체)
    case "unprotectedLeftTurn": {
      const idx = firstIndex((r) => {
        const msg = s(r.scenarioMessage);
        return msg.includes("ult") || msg.includes("left");
      });
      if (idx >= 0) return { index: idx, time: getTime(rows[idx]), source: "message" };
      return null;
    }

    case "channelizedRightTurn": {
      const idx = firstIndex((r) => {
        const msg = s(r.scenarioMessage);
        return msg.includes("channel") || msg.includes("right");
      });
      if (idx >= 0) return { index: idx, time: getTime(rows[idx]), source: "message" };
      return null;
    }

    default:
      return null;
  }
}