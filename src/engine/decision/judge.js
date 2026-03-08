// src/engine/decision/judge.js
import {
  JUDGEMENTS,
  QC_RULES,
  REDFLAG_TYPES,
  MAJOR_REDFLAGS,
  PEDESTRIAN_EVENT_IDS,
  PEDESTRIAN_IMMEDIATE_UNFIT_TYPES,
  ULT_IMMEDIATE_UNFIT_TYPES,
  EVENT_IDS,
} from "./rules";

/** 유틸: 안전한 배열 */
function arr(v) {
  return Array.isArray(v) ? v : [];
}

/** 유틸: redFlags를 표준 형태로 정리 */
function normalizeRedFlags(eventResult) {
  const flags = arr(eventResult?.redFlags).map((f) => ({
    type: f?.type,
    severity: f?.severity, // optional
    description: f?.description,
  }));
  // type 없는 항목 제거
  return flags.filter((f) => typeof f.type === "string" && f.type.length > 0);
}

/** 유틸: 이벤트가 비었는지 판단 */
function isEmptyEvent(eventResult) {
  if (!eventResult) return true;
  if (eventResult.empty === true) return true;
  // rowsCount/rowCount 등 유저가 넣을 수 있으니 유연하게 처리
  const c =
    eventResult.rowsCount ??
    eventResult.rowCount ??
    eventResult?.stats?.rowCount ??
    undefined;
  if (typeof c === "number") return c <= 0;
  // 값이 없으면 "비었다고 단정"하지 않음
  return false;
}

/** 유틸: 전체 rowCount */
function getTotalRowCount(globalStats) {
  const n =
    globalStats?.totalRows ??
    globalStats?.rowCount ??
    globalStats?.stats?.rowCount ??
    undefined;
  return typeof n === "number" ? n : undefined;
}

/** reason 생성 */
function makeReason({ gate, judgement, eventId, eventName, indicator, type, description }) {
  return {
    gate,
    judgement,
    eventId,
    eventName,
    indicator, // "A".."F" or label
    type, // REDFLAG_TYPES 등
    description,
  };
}

/**
 * 최종 판정 함수
 * @param {Array} eventResults - 5개 이벤트 결과(순서 무관)
 * @param {Object} globalStats - (선택) 전체 평균속도 등 보조 지표
 * @returns {{
 *   finalJudgement: "FIT"|"CONDITIONAL"|"UNFIT"|"INVALID",
 *   reasons: Array,
 *   recommendedRestrictions: Array<string>,
 *   summary: Object
 * }}
 */
export function judge(eventResults, globalStats = {}) {
  const events = arr(eventResults);
  const reasons = [];
  const recommendedRestrictions = [];

  // -------------------------
  // Gate 0: QC(판정 불가)
  // -------------------------
  const emptyCount = events.filter(isEmptyEvent).length;

  const totalRows = getTotalRowCount(globalStats);
  if (typeof totalRows === "number" && totalRows < QC_RULES.invalidIfTotalRowsLessThan) {
    reasons.push(
      makeReason({
        gate: "Gate0",
        judgement: JUDGEMENTS.INVALID,
        type: "QC_TOTAL_ROWS_TOO_LOW",
        description: `전체 로그 행 수가 너무 적습니다 (${totalRows}).`,
      })
    );
    return {
      finalJudgement: JUDGEMENTS.INVALID,
      reasons,
      recommendedRestrictions,
      summary: summarize(events, globalStats),
    };
  }

  if (emptyCount >= QC_RULES.invalidIfEmptyEventsAtLeast) {
    reasons.push(
      makeReason({
        gate: "Gate0",
        judgement: JUDGEMENTS.INVALID,
        type: "QC_EVENTS_MISSING",
        description: `이벤트 데이터가 비어있는 항목이 ${emptyCount}개입니다.`,
      })
    );
    return {
      finalJudgement: JUDGEMENTS.INVALID,
      reasons,
      recommendedRestrictions,
      summary: summarize(events, globalStats),
    };
  }

  // 이벤트별 redFlags 수집
  const allFlags = [];
  for (const ev of events) {
    const flags = normalizeRedFlags(ev);
    for (const f of flags) {
      allFlags.push({
        ...f,
        eventId: ev.eventId,
        eventName: ev.eventName,
      });
    }
  }

  // -------------------------
  // Gate 1: 즉시 UNFIT
  // -------------------------
  // 1) 충돌 1회라도
  const collision = allFlags.find((f) => f.type === REDFLAG_TYPES.COLLISION);
  if (collision) {
    reasons.push(
      makeReason({
        gate: "Gate1",
        judgement: JUDGEMENTS.UNFIT,
        eventId: collision.eventId,
        eventName: collision.eventName,
        type: collision.type,
        description: collision.description ?? "충돌 발생",
      })
    );
    return {
      finalJudgement: JUDGEMENTS.UNFIT,
      reasons,
      recommendedRestrictions,
      summary: summarize(events, globalStats),
    };
  }

  // 2) 보행자 이벤트에서 중대 위험 1회라도
  const pedImmediate = allFlags.find(
    (f) => PEDESTRIAN_EVENT_IDS.has(f.eventId) && PEDESTRIAN_IMMEDIATE_UNFIT_TYPES.has(f.type)
  );
  if (pedImmediate) {
    reasons.push(
      makeReason({
        gate: "Gate1",
        judgement: JUDGEMENTS.UNFIT,
        eventId: pedImmediate.eventId,
        eventName: pedImmediate.eventName,
        type: pedImmediate.type,
        description: pedImmediate.description ?? "보행자 이벤트에서 중대 위험",
      })
    );
    return {
      finalJudgement: JUDGEMENTS.UNFIT,
      reasons,
      recommendedRestrictions,
      summary: summarize(events, globalStats),
    };
  }

  // 3) ULT에서 중대 위반 1회라도
  const ultImmediate = allFlags.find(
    (f) => f.eventId === EVENT_IDS.ULT && ULT_IMMEDIATE_UNFIT_TYPES.has(f.type)
  );
  if (ultImmediate) {
    reasons.push(
      makeReason({
        gate: "Gate1",
        judgement: JUDGEMENTS.UNFIT,
        eventId: ultImmediate.eventId,
        eventName: ultImmediate.eventName,
        type: ultImmediate.type,
        description: ultImmediate.description ?? "비보호 좌회전에서 중대 위반",
      })
    );
    return {
      finalJudgement: JUDGEMENTS.UNFIT,
      reasons,
      recommendedRestrictions,
      summary: summarize(events, globalStats),
    };
  }

  // -------------------------
  // Gate 2: RedFlag 누적
  // -------------------------
  const majorFlags = allFlags.filter((f) => MAJOR_REDFLAGS.has(f.type) || f.severity === "major");
  if (majorFlags.length >= 2) {
    for (const f of majorFlags.slice(0, 3)) {
      reasons.push(
        makeReason({
          gate: "Gate2",
          judgement: JUDGEMENTS.UNFIT,
          eventId: f.eventId,
          eventName: f.eventName,
          type: f.type,
          description: f.description ?? "중대 RedFlag 누적",
        })
      );
    }
    return {
      finalJudgement: JUDGEMENTS.UNFIT,
      reasons,
      recommendedRestrictions,
      summary: summarize(events, globalStats),
    };
  }

  if (majorFlags.length === 1) {
    const f = majorFlags[0];
    reasons.push(
      makeReason({
        gate: "Gate2",
        judgement: JUDGEMENTS.CONDITIONAL,
        eventId: f.eventId,
        eventName: f.eventName,
        type: f.type,
        description: f.description ?? "중대 RedFlag 1회",
      })
    );
    // 조건부 제한 자동 제안
    recommendedRestrictions.push(...suggestRestrictionsFromFlag(f));
    return {
      finalJudgement: JUDGEMENTS.CONDITIONAL,
      reasons,
      recommendedRestrictions,
      summary: summarize(events, globalStats),
    };
  }

  // -------------------------
  // Gate 3: 프로파일(패턴) 기반
  // Step3에서는 “규칙 자리”를 고정하고,
  // 실제 A~F 산출은 Step4에서 flags로 변환해 넣는 방식 추천.
  // -------------------------

  const profile = buildProfile(allFlags);

  // UNFIT 패턴 1) A fail 2개 이상 이벤트
  if (profile.hazardFailEventCount >= 2) {
    reasons.push(
      makeReason({
        gate: "Gate3",
        judgement: JUDGEMENTS.UNFIT,
        type: REDFLAG_TYPES.HAZARD_DETECTION_FAIL,
        description: `위험 인지 실패(A)가 ${profile.hazardFailEventCount}개 이벤트에서 반복`,
      })
    );
    return {
      finalJudgement: JUDGEMENTS.UNFIT,
      reasons,
      recommendedRestrictions,
      summary: summarize(events, globalStats),
    };
  }

  // UNFIT 패턴 2) E + F 결합
  if (profile.repetitionMajorEventCount >= 2 && profile.awarenessPoorEventCount >= 1) {
    reasons.push(
      makeReason({
        gate: "Gate3",
        judgement: JUDGEMENTS.UNFIT,
        type: "PROFILE_E_PLUS_F",
        description: "오류 반복(E) + 사후 인식 저하(F) 패턴",
      })
    );
    return {
      finalJudgement: JUDGEMENTS.UNFIT,
      reasons,
      recommendedRestrictions,
      summary: summarize(events, globalStats),
    };
  }

  // UNFIT 패턴 3) 보행자/급정거 포함 B 심각지연 2개 이상
  if (profile.responseSevereDelayHighRiskEventCount >= 2) {
    reasons.push(
      makeReason({
        gate: "Gate3",
        judgement: JUDGEMENTS.UNFIT,
        type: REDFLAG_TYPES.RESPONSE_TIME_SEVERE_DELAY,
        description: `고위험 이벤트(보행자/급정거)에서 반응 지연(B) ${profile.responseSevereDelayHighRiskEventCount}회`,
      })
    );
    return {
      finalJudgement: JUDGEMENTS.UNFIT,
      reasons,
      recommendedRestrictions,
      summary: summarize(events, globalStats),
    };
  }

  // CONDITIONAL 패턴: 특정 이벤트에만 문제(예: B severe가 1회 등)
  if (
    profile.anyMinorOrProfileConcern ||
    profile.responseSevereDelayHighRiskEventCount === 1 ||
    profile.ruleMajorEventCount === 1
  ) {
    reasons.push(
      makeReason({
        gate: "Gate3",
        judgement: JUDGEMENTS.CONDITIONAL,
        type: "PROFILE_MODERATE_RISK",
        description: "특정 이벤트 중심의 위험 패턴(조건부 적합)",
      })
    );
    recommendedRestrictions.push(...suggestRestrictionsFromProfile(profile));
    return {
      finalJudgement: JUDGEMENTS.CONDITIONAL,
      reasons,
      recommendedRestrictions,
      summary: summarize(events, globalStats),
    };
  }

  // FIT: 여기까지 걸리지 않으면 적합
  return {
    finalJudgement: JUDGEMENTS.FIT,
    reasons: [
      makeReason({
        gate: "Gate3",
        judgement: JUDGEMENTS.FIT,
        type: "NO_REDFLAG_STABLE_PROFILE",
        description: "중대 RedFlag 없음, 위험 패턴 뚜렷하지 않음",
      }),
    ],
    recommendedRestrictions: [],
    summary: summarize(events, globalStats),
  };
}

/** 프로파일(패턴) 구성 */
function buildProfile(allFlags) {
  const byEvent = new Map();
  for (const f of allFlags) {
    if (!byEvent.has(f.eventId)) byEvent.set(f.eventId, []);
    byEvent.get(f.eventId).push(f);
  }

  const eventIds = Array.from(byEvent.keys());

  const hazardFailEvents = new Set();
  const repetitionMajorEvents = new Set();
  const awarenessPoorEvents = new Set();
  const ruleMajorEvents = new Set();
  const responseSevereDelayHighRiskEvents = new Set();

  for (const id of eventIds) {
    const flags = byEvent.get(id) || [];
    for (const f of flags) {
      if (f.type === REDFLAG_TYPES.HAZARD_DETECTION_FAIL) hazardFailEvents.add(id);
      if (f.type === REDFLAG_TYPES.REPETITION_MAJOR) repetitionMajorEvents.add(id);
      if (f.type === REDFLAG_TYPES.AWARENESS_POOR) awarenessPoorEvents.add(id);
      if (f.type === REDFLAG_TYPES.RULE_MAJOR) ruleMajorEvents.add(id);

      const isHighRisk = PEDESTRIAN_EVENT_IDS.has(id) || id === EVENT_IDS.HARD_BRAKE;
      if (isHighRisk && f.type === REDFLAG_TYPES.RESPONSE_TIME_SEVERE_DELAY) {
        responseSevereDelayHighRiskEvents.add(id);
      }
    }
  }

  return {
    hazardFailEventCount: hazardFailEvents.size,
    repetitionMajorEventCount: repetitionMajorEvents.size,
    awarenessPoorEventCount: awarenessPoorEvents.size,
    ruleMajorEventCount: ruleMajorEvents.size,
    responseSevereDelayHighRiskEventCount: responseSevereDelayHighRiskEvents.size,

    // “뭔가 수상함” 플래그(향후 확장)
    anyMinorOrProfileConcern: allFlags.some((f) => f.severity === "minor"),
  };
}

/** 제한 권고: 단일 flag 기반 */
function suggestRestrictionsFromFlag(flag) {
  const out = [];
  // 보행자 관련
  if (PEDESTRIAN_EVENT_IDS.has(flag.eventId)) {
    out.push("보행자 밀집 구역(학교/시장/주거지) 운전 제한");
  }
  // ULT 관련
  if (flag.eventId === EVENT_IDS.ULT) {
    out.push("비보호 좌회전 많은 경로 제한(신호교차로 우회 권고)");
  }
  // 급정거 관련
  if (flag.eventId === EVENT_IDS.HARD_BRAKE) {
    out.push("차간거리 유지 및 ADAS(FCW/AEB) 사용 권고");
  }
  return dedupe(out);
}

/** 제한 권고: 프로파일 기반 */
function suggestRestrictionsFromProfile(profile) {
  const out = [];
  if (profile.responseSevereDelayHighRiskEventCount >= 1) {
    out.push("차간거리 유지 교육 및 ADAS(FCW/AEB) 사용 권고");
  }
  if (profile.hazardFailEventCount >= 1) {
    out.push("보행자 밀집 구역 및 복잡 교차로 운전 제한");
  }
  if (profile.ruleMajorEventCount >= 1) {
    out.push("혼잡 교차로/비보호 좌회전 경로 제한");
  }
  return dedupe(out);
}

function dedupe(list) {
  return Array.from(new Set(list)).filter(Boolean);
}

/** 요약(디버깅/리포팅용) */
function summarize(events, globalStats) {
  const emptyEvents = events.filter(isEmptyEvent).map((e) => e.eventId);
  return {
    qc: {
      totalRows: getTotalRowCount(globalStats),
      emptyEvents,
    },
    globalStats: {
      avgSpeedKph: globalStats?.avgSpeedKph,
      speedOverRatio: globalStats?.speedOverRatio,
    },
  };
}