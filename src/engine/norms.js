// src/engine/norms.js
// 컷오프 중심(주의/고위험) 기준값 샘플(placeholder)
// - 실제 임계값은 향후 정상군/환자군 데이터 + 병원/연구 기준으로 보정 필요

export const NORMS = {
  // 공통 지표(대부분 이벤트에 공통 적용)
  rt: {
    kind: "cutoff",
    cautionHigh: null,     // 예: 2.0  (초)  -> 주의
    highRiskHigh: null,    // 예: 3.0  (초)  -> 고위험
    unit: "s",
    note: "반응시간 컷오프는 자극 정의(t0)·반응 탐지 규칙에 따라 보정 필요",
    source: "TBD",
  },
  noResponse: {
    kind: "cutoff-rate",
    cautionHigh: null,     // 예: 0.2  (20%) -> 주의
    highRiskHigh: null,    // 예: 0.4  (40%) -> 고위험
    unit: "%",
    note: "무반응 비율은 이벤트 설계/반응 정의 기준에 따라 보정 필요",
    source: "TBD",
  },

  // 이벤트 특화
  schoolZone_exceedRatio: {
    kind: "cutoff",
    cautionHigh: null,     // 예: 10 (%) -> 주의
    highRiskHigh: null,    // 예: 25 (%) -> 고위험
    unit: "%",
    note: "보호구역 초과시간 비율(%)",
    source: "TBD",
  },
  schoolZone_maxExcess: {
    kind: "cutoff",
    cautionHigh: null,     // 예: 5 (kph)
    highRiskHigh: null,    // 예: 10 (kph)
    unit: "kph",
    note: "보호구역 최대 초과량(kph)",
    source: "TBD",
  },
  schoolZone_sustain: {
    kind: "cutoff",
    cautionHigh: null,     // 예: 2.0 (s)
    highRiskHigh: null,    // 예: 5.0 (s)
    unit: "s",
    note: "보호구역 연속 초과 지속시간(s)",
    source: "TBD",
  },

  ttc_min: {
    kind: "cutoff-lower-worse",
    cautionLow: null,      // 예: 2.0 (s) 이하 주의
    highRiskLow: null,     // 예: 1.5 (s) 이하 고위험
    unit: "s",
    note: "TTC는 낮을수록 위험(시나리오 속도/거리 모델에 따라 보정 필요)",
    source: "TBD",
  },
  ttc_under: {
    kind: "cutoff",
    cautionHigh: null,     // 예: 1.0 (s)
    highRiskHigh: null,    // 예: 2.5 (s)
    unit: "s",
    note: "위험 TTC(임계 이하) 누적 지속시간(s)",
    source: "TBD",
  },
  brakeReaction: {
    kind: "cutoff",
    cautionHigh: null,     // 예: 1.0 (s)
    highRiskHigh: null,    // 예: 1.5 (s)
    unit: "s",
    note: "위험 시작 이후 제동 반응시간(s)",
    source: "TBD",
  },
  ped_speedDrop: {
    kind: "cutoff-lower-worse",
    cautionLow: null,      // 예: 10 (kph) 미만 주의 (감속이 너무 적음)
    highRiskLow: null,     // 예: 5 (kph) 미만 고위험
    unit: "kph",
    note: "보행자 자극 이후 감속량(kph): 낮으면 위험",
    source: "TBD",
  },
  control_laneOffset: {
    kind: "cutoff",
    cautionHigh: null,     // 예: 1.0
    highRiskHigh: null,    // 예: 1.5
    unit: "",
    note: "차선 중심 편차 최대값",
    source: "TBD",
  },
  control_steerSpike: {
    kind: "cutoff",
    cautionHigh: null,     // 예: 0.8
    highRiskHigh: null,    // 예: 0.95
    unit: "",
    note: "급조향(max|steering|)",
    source: "TBD",
  },
};