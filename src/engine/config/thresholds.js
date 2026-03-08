// src/engine/config/thresholds.js

export const THRESHOLDS = {
  // 반응 없음 판단: 이벤트 구간 내에서 brake/throttle/steering 변화가 거의 없으면 "반응 없음"
  minBrakeForResponse: 0.1,        // brake가 0~1이라고 가정한 임시 기준
  minSteeringAbsForResponse: 0.15, // steering 절대값 임시 기준
  minSpeedDropKphForResponse: 5,   // 속도 감소로 반응 판단

  // 반응시간(초) - 지금은 event 구간 시작 시점 기준의 임시 정의
  severeResponseTimeSec: 2.5,      // 심각 지연(초)
  moderateResponseTimeSec: 1.5,    // 중간 위험

  // ULT / 우회전 등에서 규칙 위반의 임시 기준(속도 초과 or speedOver flag)
  speedOverAsViolation: true,

  // 차선이탈(부적절 반응) 임시 기준
  laneOffsetMajor: 1.2,            // m 가정(로그 단위에 따라 조정)

  // ULT(비보호 좌회전) - TTC 기반 위험진입 판단
  ultTtcCriticalSec: 2.0,
  ultMinTimeUnderTtcSec: 0.8,
  ultMinSpeedDropKph: 5,
  ultMinBrakeForYield: 0.1,

  // -----------------------------
  // ✅ 추가: 어린이 보호구역(schoolZone)
  schoolZoneSpeedLimitKph: 30,
  schoolZoneMinExceedKph: 5,          // 제한+5kph 이상이면 의미있는 초과로 집계
  schoolZoneExceedRatioFlag: 0.15,    // 초과 시간 비율이 15% 이상이면 플래그
  schoolZoneSustainExceedSecFlag: 3.0,// 연속 초과가 3초 이상이면 플래그

  // ✅ 추가: 전방차량 급정거(leadVehicleHardBrake)
  hardBrakeTtcCriticalSec: 2.0,
  hardBrakeMinTimeUnderTtcSec: 0.8,
  hardBrakeLateBrakeResponseSec: 1.5,  // TTC 위험 시작 이후 브레이크 반응이 1.5s 넘으면 지연
  hardBrakeMinBrakeForResponse: 0.1,

  // ✅ 추가: 무단횡단 보행자(jaywalkingPedestrian)
  pedestrianMinBrakeForResponse: 0.1,
  pedestrianMinSpeedDropKphForResponse: 5,

  // ✅ 추가: 도류화 우회전(channelizedRightTurn)
  rightTurnLaneOffsetMajor: 1.2,        // 차선 중심 이탈
  rightTurnSteerSpikeAbs: 0.8,          // 급조향(절대값)
};