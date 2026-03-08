// src/engine/decision/rules.js
// Decision Engine v1.0 - 규칙/게이트 정의
// - Step3에서는 "판정 로직"을 고정하는 것이 목표
// - 실제 이벤트별 지표 계산(indicators)은 Step4에서 붙인다.

export const JUDGEMENTS = {
  FIT: "FIT",
  CONDITIONAL: "CONDITIONAL",
  UNFIT: "UNFIT",
  INVALID: "INVALID",
};

// 이벤트 ID 표준(설정 파일 eventsConfig.js와 동일한 ID 사용 권장)
export const EVENT_IDS = {
  SCHOOL_ZONE: "schoolZone",
  ULT: "unprotectedLeftTurn",
  JAYWALK: "jaywalkingPedestrian",
  CHANNEL_RIGHT: "channelizedRightTurn",
  HARD_BRAKE: "leadVehicleHardBrake",
};

// Gate0: 데이터 품질(판정 불가) 기준
export const QC_RULES = {
  // 이벤트 세그먼트(구간)가 비어있는 이벤트가 이 개수 이상이면 INVALID
  invalidIfEmptyEventsAtLeast: 3,

  // 전체 row가 너무 적으면(샘플링이 너무 희소) 반응시간/이벤트 해석이 어려움
  // (임시 기본값) - 나중에 필요하면 조정
  invalidIfTotalRowsLessThan: 50,
};

// Gate1/2/3에서 사용하는 RedFlag “타입” 표준
export const REDFLAG_TYPES = {
  COLLISION: "COLLISION",
  PED_HAZARD_MISS_NO_RESPONSE: "PED_HAZARD_MISS_NO_RESPONSE",
  ULT_MAJOR_YIELD_VIOLATION: "ULT_MAJOR_YIELD_VIOLATION",

  // 누적/패턴용
  HAZARD_DETECTION_FAIL: "HAZARD_DETECTION_FAIL", // A fail
  RESPONSE_TIME_SEVERE_DELAY: "RESPONSE_TIME_SEVERE_DELAY", // B severe
  INAPPROPRIATE_MAJOR: "INAPPROPRIATE_MAJOR", // C major
  RULE_MAJOR: "RULE_MAJOR", // D major
  REPETITION_MAJOR: "REPETITION_MAJOR", // E major
  AWARENESS_POOR: "AWARENESS_POOR", // F poor
};

// “중대 실패”로 취급할 RedFlag 타입 집합
export const MAJOR_REDFLAGS = new Set([
  REDFLAG_TYPES.COLLISION,
  REDFLAG_TYPES.PED_HAZARD_MISS_NO_RESPONSE,
  REDFLAG_TYPES.ULT_MAJOR_YIELD_VIOLATION,
  REDFLAG_TYPES.INAPPROPRIATE_MAJOR,
  REDFLAG_TYPES.RULE_MAJOR,
]);

// 보행자 이벤트(무단횡단/도류화 우회전)
export const PEDESTRIAN_EVENT_IDS = new Set([
  EVENT_IDS.JAYWALK,
  EVENT_IDS.CHANNEL_RIGHT,
]);

// “보행자 이벤트에서 중대 위험”을 Gate1에서 바로 UNFIT로 처리하기 위한 타입(확장 가능)
export const PEDESTRIAN_IMMEDIATE_UNFIT_TYPES = new Set([
  REDFLAG_TYPES.PED_HAZARD_MISS_NO_RESPONSE,
  REDFLAG_TYPES.COLLISION,
]);

// ULT(비보호 좌회전)에서 중대 위반 → Gate1 UNFIT
export const ULT_IMMEDIATE_UNFIT_TYPES = new Set([
  REDFLAG_TYPES.ULT_MAJOR_YIELD_VIOLATION,
  REDFLAG_TYPES.COLLISION,
]);

/**
 * 이벤트 결과 객체(eventResult) 표준(권장)
 * {
 *   eventId: string,
 *   eventName: string,
 *   // 이벤트 세그먼트 데이터가 없는 경우 empty=true로 두거나 rowsCount=0 가능
 *   empty?: boolean,
 *   metrics?: { ... }, // (Step4에서 지표 계산 결과가 들어올 자리)
 *   indicators?: { A?:..., B?:..., C?:..., D?:..., E?:..., F?:... }, // (선택)
 *   redFlags?: Array<{ type: string, severity?: "major"|"minor", description?: string }>,
 *   notes?: string[]
 * }
 *
 * Step3에서는 redFlags 중심으로 판정.
 */