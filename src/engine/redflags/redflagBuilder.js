// src/engine/redflags/redflagBuilder.js
import { REDFLAG_TYPES, EVENT_IDS, PEDESTRIAN_EVENT_IDS } from "../decision/rules";

function s(v) {
  return (v ?? "").toString().toLowerCase();
}

function hasCollision(rows) {
  for (const r of rows || []) {
    const c = r.collisionWithUser;
    if (c === undefined || c === null || c === "") continue;
    const str = String(c).trim().toLowerCase();
    if (["true", "1", "yes", "collision"].includes(str)) return true;
    if (str.length > 0 && !["false", "0", "no"].includes(str)) return true;
  }
  return false;
}

export function buildRedFlags({ eventId, eventName, rows, indicators }) {
  const redFlags = [];

  // 1) Collision -> 즉시 UNFIT
  if (hasCollision(rows)) {
    redFlags.push({
      type: REDFLAG_TYPES.COLLISION,
      severity: "major",
      description: "충돌 발생(collisionWithUser 감지)",
    });
    return redFlags;
  }

  const b = indicators?.B;
  const a = indicators?.A;

  // 2) 보행자 이벤트: t0 이후 NO_RESPONSE -> 즉시 UNFIT
  if (PEDESTRIAN_EVENT_IDS.has(eventId)) {
    const noResponse = b?.severity === "NO_RESPONSE";
    const hazardMiss = a?.hazardDetected === false;

    if (hazardMiss && noResponse) {
      redFlags.push({
        type: REDFLAG_TYPES.PED_HAZARD_MISS_NO_RESPONSE,
        severity: "major",
        description: "보행자 이벤트에서 t0 이후 반응 없음(인지 실패 + 반응 없음)",
      });
      return redFlags;
    }
  }

  // 3) 급정거 이벤트에서도 NO_RESPONSE는 매우 위험(즉시 UNFIT까지는 정책에 따라)
  if (eventId === EVENT_IDS.HARD_BRAKE) {
    if (b?.severity === "NO_RESPONSE") {
      redFlags.push({
        type: REDFLAG_TYPES.RESPONSE_TIME_SEVERE_DELAY,
        severity: "major",
        description: "급정거 이벤트에서 t0 이후 반응 없음(중대 위험)",
      });
      // 여기서 즉시 return은 안 함(정책에 따라 Gate1로 올릴 수도 있음)
    }
  }

  // 4) ULT 중대 위반(1차: ruleViolation로 대체)
  if (eventId === EVENT_IDS.ULT) {
    if (indicators?.D?.ruleViolation === true) {
      redFlags.push({
        type: REDFLAG_TYPES.ULT_MAJOR_YIELD_VIOLATION,
        severity: "major",
        description: "비보호 좌회전에서 규칙/양보 위반(임시 기준)",
      });
      return redFlags;
    }
  }

  // --- 패턴/보조 플래그 ---
  if (a?.hazardDetected === false) {
    redFlags.push({
      type: REDFLAG_TYPES.HAZARD_DETECTION_FAIL,
      severity: "minor",
      description: "위험 인지 실패(A) 의심",
    });
  }

  if (b?.severity === "SEVERE") {
    redFlags.push({
      type: REDFLAG_TYPES.RESPONSE_TIME_SEVERE_DELAY,
      severity: "minor",
      description: "반응 개시 지연(B) 심각",
    });
  }

  if (indicators?.C?.inappropriateMajor === true) {
    redFlags.push({
      type: REDFLAG_TYPES.INAPPROPRIATE_MAJOR,
      severity: "major",
      description: "부적절 반응(C): 차선이탈/급조향 위험(임시 기준)",
    });
  }

  if (indicators?.D?.ruleViolation === true) {
    redFlags.push({
      type: REDFLAG_TYPES.RULE_MAJOR,
      severity: "major",
      description: "규칙/양보 준수(D) 위반(임시 기준)",
    });
  }

  // (선택) scenarioMessage 기반 디버그용 노트 플래그(향후 제거 가능)
  if (rows?.some(r => s(r.scenarioMessage).includes("warning"))) {
    redFlags.push({
      type: "SCENARIO_WARNING_MESSAGE",
      severity: "minor",
      description: "scenarioMessage에 warning 키워드 감지(참고)",
    });
  }

  return redFlags;
}