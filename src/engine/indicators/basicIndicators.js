// src/engine/indicators/basicIndicators.js
import { THRESHOLDS } from "../config/thresholds";
import { findStimulusT0 } from "../triggers/trigger";

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function abs(v) {
  const n = num(v);
  return n === undefined ? undefined : Math.abs(n);
}
function getTime(r) {
  return num(r?.scenarioTime ?? r?.time);
}

function safeDt(tPrev, tCur) {
  if (tPrev === undefined || tCur === undefined) return 0;
  return Math.max(0, tCur - tPrev);
}

function computeMaxSustainedDuration(rows, predicate) {
  // predicate(r) true 인 상태가 연속으로 이어진 최대 지속시간(초)
  let maxDur = 0;
  let curDur = 0;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    const dt = safeDt(getTime(prev), getTime(cur));
    if (predicate(cur)) curDur += dt;
    else {
      maxDur = Math.max(maxDur, curDur);
      curDur = 0;
    }
  }
  return Math.max(maxDur, curDur);
}

function findFirstIndexAfter(rows, startIdx, predicate) {
  for (let i = startIdx; i < rows.length; i++) {
    if (predicate(rows[i], i)) return i;
  }
  return -1;
}

/**
 * eventId 기반으로 t0를 잡아 지표를 계산한다.
 * - t0 못 찾으면: 이벤트 구간 시작(row[0])을 t0로 fallback
 */
export function computeBasicIndicatorsForSegment(rows, eventId) {
  if (!rows || rows.length === 0) {
    return {
      A: { hazardDetected: false, latencySec: undefined, t0: null },
      B: { responseTimeSec: undefined, responseDetected: false, severity: "NA", t0: null },
      C: { inappropriateMajor: false },
      D: { ruleViolation: false },
      E: { repeatedError: false },
      F: { awarenessPoor: false },
      _debug: { rowCount: 0 },
      _eventMetrics: null,
      _ult: null,
    };
  }

  const t0Obj = findStimulusT0(rows, eventId);
  const t0Index = t0Obj?.index ?? 0;
  const t0 = t0Obj?.time ?? getTime(rows[0]);

  const v0 = num(rows[t0Index]?.speedKph ?? rows[0]?.speedKph);

  let firstResponseTimeSec = undefined;
  let responseDetected = false;

  let maxBrake = 0;
  let maxSteerAbs = 0;
  let minSpeed = v0 ?? Infinity;

  let ruleViolation = false;
  let laneOffsetMajor = false;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const t = getTime(r);
    const v = num(r.speedKph);
    const br = num(r.brake) ?? 0;
    const stAbs = abs(r.steering) ?? 0;

    if (v !== undefined) minSpeed = Math.min(minSpeed, v);

    maxBrake = Math.max(maxBrake, br);
    maxSteerAbs = Math.max(maxSteerAbs, stAbs);

    if (THRESHOLDS.speedOverAsViolation && r.speedOver === true) {
      ruleViolation = true;
    }

    const off = abs(r.offsetFromLaneCenter);
    if (off !== undefined && off >= THRESHOLDS.laneOffsetMajor) {
      laneOffsetMajor = true;
    }

    // t0 이전은 반응 탐지에서 제외
    if (i < t0Index) continue;

    const speedDrop = (v0 !== undefined && v !== undefined) ? (v0 - v) : undefined;

    const reacted =
      (br >= THRESHOLDS.minBrakeForResponse) ||
      (stAbs >= THRESHOLDS.minSteeringAbsForResponse) ||
      (speedDrop !== undefined && speedDrop >= THRESHOLDS.minSpeedDropKphForResponse);

    if (!responseDetected && reacted && t0 !== undefined && t !== undefined) {
      responseDetected = true;
      firstResponseTimeSec = Math.max(0, t - t0);
    }
  }

  // A: 위험인지(1차): t0 이후 반응이 있으면 탐지로 간주
  const hazardDetected = responseDetected;
  const latencySec = firstResponseTimeSec;

  // B: 반응시간 severity
  let severity = "NA";
  if (firstResponseTimeSec !== undefined) {
    if (firstResponseTimeSec >= THRESHOLDS.severeResponseTimeSec) severity = "SEVERE";
    else if (firstResponseTimeSec >= THRESHOLDS.moderateResponseTimeSec) severity = "MODERATE";
    else severity = "OK";
  } else {
    severity = "NO_RESPONSE";
  }

  // C: 부적절 반응(임시)
  const inappropriateMajor = laneOffsetMajor || (maxSteerAbs >= 0.8);

  // -----------------------------
  // ✅ 이벤트별 추가 지표(eventMetrics)
  // (병원 설명/연구용으로 raw 값을 남기기 위해)
  let eventMetrics = null;

  // 1) 어린이 보호구역 감속(schoolZone)
  if (eventId === "schoolZone") {
    const limit = THRESHOLDS.schoolZoneSpeedLimitKph ?? 30;
    const minExceed = THRESHOLDS.schoolZoneMinExceedKph ?? 5;

    let totalTime = 0;
    let exceedTime = 0;
    let maxExcessKph = 0;

    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const cur = rows[i];
      const dt = safeDt(getTime(prev), getTime(cur));
      totalTime += dt;

      const v = num(cur.speedKph);
      const lim = num(cur.speedLimit) ?? limit;
      if (v !== undefined && lim !== undefined) {
        const excess = v - lim;
        if (excess > 0) maxExcessKph = Math.max(maxExcessKph, excess);
        if (excess >= minExceed) exceedTime += dt;
      }
    }

    const exceedTimeRatio = totalTime > 0 ? exceedTime / totalTime : undefined;
    const maxSustainedExceedSec = computeMaxSustainedDuration(
      rows,
      (r) => {
        const v = num(r.speedKph);
        const lim = num(r.speedLimit) ?? limit;
        return v !== undefined && lim !== undefined && (v - lim) >= minExceed;
      }
    );

    eventMetrics = {
      speedLimitKph: limit,
      exceedTimeRatio,
      maxExcessKph,
      maxSustainedExceedSec,
      windowTotalSec: totalTime,
    };
  }

  // 2) 무단횡단 보행자(jaywalkingPedestrian)
  if (eventId === "jaywalkingPedestrian") {
    const t0Idx = t0Index ?? 0;
    const vAtT0 = num(rows[t0Idx]?.speedKph);
    let minVAfter = vAtT0 ?? undefined;
    let maxBrakeAfter = 0;

    for (let i = t0Idx; i < rows.length; i++) {
      const r = rows[i];
      const v = num(r.speedKph);
      const br = num(r.brake) ?? 0;
      if (v !== undefined && minVAfter !== undefined) minVAfter = Math.min(minVAfter, v);
      if (v !== undefined && minVAfter === undefined) minVAfter = v;
      maxBrakeAfter = Math.max(maxBrakeAfter, br);
    }

    const speedDrop = (vAtT0 !== undefined && minVAfter !== undefined) ? (vAtT0 - minVAfter) : undefined;

    eventMetrics = {
      speedAtT0: vAtT0,
      minSpeedAfterT0: minVAfter,
      speedDropAfterT0: speedDrop,
      maxBrakeAfterT0: maxBrakeAfter,
    };
  }

  // 3) 도류화 우회전(channelizedRightTurn)
  if (eventId === "channelizedRightTurn") {
  let maxLaneOffset = 0;
  let maxYawRate = 0; // 추가

  for (let i = 0; i < rows.length; i++) {
    const off = abs(rows[i].offsetFromLaneCenter) ?? 0;
    maxLaneOffset = Math.max(maxLaneOffset, off);
    
    // 각속도의 절대값 최대치 계산 (회전 조작의 급격함 확인) 
    const yr = abs(rows[i].yawRate) ?? 0;
    maxYawRate = Math.max(maxYawRate, yr);
  }
  
  eventMetrics = {
    maxLaneOffset,
    maxSteerAbs,
    maxYawRate, // 리포트용 데이터로 전달
    minSpeedKph: (minSpeed !== Infinity ? minSpeed : undefined),
  };
}

  // 4) 전방차량 급정거(leadVehicleHardBrake) - TTC 기반
  if (eventId === "leadVehicleHardBrake") {
    const TTC_CRIT = THRESHOLDS.hardBrakeTtcCriticalSec ?? 2.0;

    let minTTC = undefined;
    let timeUnder = 0;

    for (let i = 0; i < rows.length; i++) {
      const ttc = num(rows[i].ttcToFrontVehicle);
      if (ttc !== undefined) minTTC = minTTC === undefined ? ttc : Math.min(minTTC, ttc);
    }
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const cur = rows[i];
      const dt = safeDt(getTime(prev), getTime(cur));
      const ttc = num(cur.ttcToFrontVehicle);
      if (ttc !== undefined && ttc > 0 && ttc <= TTC_CRIT) timeUnder += dt;
    }

    // 위험 시작(t0Hazard): TTC가 임계값 이하로 처음 들어간 시점
    const hazardStartIdx = findFirstIndexAfter(rows, 0, (r) => {
      const ttc = num(r.ttcToFrontVehicle);
      return ttc !== undefined && ttc > 0 && ttc <= TTC_CRIT;
    });

    let brakeReactionSec = undefined;
    let maxBrakeAfterHazard = 0;

    if (hazardStartIdx >= 0) {
      const hazardTime = getTime(rows[hazardStartIdx]);

      // hazard 이후 브레이크가 의미있게 들어가는 첫 시점
      const brIdx = findFirstIndexAfter(rows, hazardStartIdx, (r) => (num(r.brake) ?? 0) >= (THRESHOLDS.hardBrakeMinBrakeForResponse ?? 0.1));
      if (brIdx >= 0) {
        const brTime = getTime(rows[brIdx]);
        if (hazardTime !== undefined && brTime !== undefined) brakeReactionSec = Math.max(0, brTime - hazardTime);
      }

      for (let i = hazardStartIdx; i < rows.length; i++) {
        maxBrakeAfterHazard = Math.max(maxBrakeAfterHazard, num(rows[i].brake) ?? 0);
      }
    }

    eventMetrics = {
      minTTC,
      timeUnderCriticalTTC: timeUnder,
      brakeReactionSec,
      maxBrakeAfterHazard,
      hazardStartDetected: hazardStartIdx >= 0,
    };
  }

  // -----------------------------
  // ✅ ULT TTC 기반 추가 지표(_ult)
  let ultMetrics = null;
  if (eventId === "unprotectedLeftTurn" && rows.length > 0) {
    const t0Idx = t0Index ?? 0;

    let minTTC = undefined;
    let timeUnder = 0;

    const vAtT0 = num(rows[t0Idx]?.speedKph);
    let minVAfter = vAtT0 ?? undefined;
    let brakeAfter = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const ttc = num(r.ttcToFrontVehicle);
      const v = num(r.speedKph);
      const br = num(r.brake) ?? 0;

      if (i >= t0Idx) {
        brakeAfter = Math.max(brakeAfter, br);
        if (v !== undefined && minVAfter !== undefined) minVAfter = Math.min(minVAfter, v);
        if (v !== undefined && minVAfter === undefined) minVAfter = v;
      }
      if (ttc !== undefined) {
        minTTC = minTTC === undefined ? ttc : Math.min(minTTC, ttc);
      }
    }

    const critical = THRESHOLDS.ultTtcCriticalSec ?? 2.0;
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const cur = rows[i];
      const dt = safeDt(getTime(prev), getTime(cur));
      const ttcCur = num(cur.ttcToFrontVehicle);
      if (ttcCur !== undefined && ttcCur > 0 && ttcCur <= critical) {
        timeUnder += dt;
      }
    }

    const speedDrop = (vAtT0 !== undefined && minVAfter !== undefined) ? (vAtT0 - minVAfter) : undefined;

    ultMetrics = {
      minTTC,
      timeUnderCriticalTTC: timeUnder,
      brakeAppliedAfterT0: brakeAfter,
      speedAtT0: vAtT0,
      minSpeedAfterT0: minVAfter,
      speedDropAfterT0: speedDrop,
    };
  }

  return {
    A: { hazardDetected, latencySec, t0: t0Obj ?? { index: 0, time: t0, source: "fallback-start" } },
    B: { responseTimeSec: firstResponseTimeSec, responseDetected, severity, t0: t0Obj ?? { index: 0, time: t0, source: "fallback-start" } },
    C: { inappropriateMajor },
    D: { ruleViolation },
    E: { repeatedError: false },
    F: { awarenessPoor: false },
    _debug: {
      rowCount: rows.length,
      t0Index,
      t0,
      maxBrake,
      maxSteerAbs,
      v0,
      minSpeed: (minSpeed !== Infinity ? minSpeed : undefined),
    },
    _eventMetrics: eventMetrics,
    _ult: ultMetrics,
  };
}