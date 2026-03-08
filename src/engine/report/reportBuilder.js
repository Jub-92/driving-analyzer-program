// src/engine/report/reportBuilder.js
import { THRESHOLDS } from "../config/thresholds";

function n(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function severityFromFlagCode(code) {
  if (code.includes("COLLISION")) return "high";
  if (code.includes("NO_RESPONSE")) return "high";
  if (code.includes("SEVERE_DELAY")) return "medium";
  if (code.includes("SPEED_EXCESS")) return "medium";
  if (code.includes("LATE_RESPONSE")) return "medium";
  if (code.includes("LANE_DEVIATION")) return "medium";
  if (code.includes("ULT_RISK_ENTRY")) return "medium";
  return "low";
}

function buildClinicalText(eventName, rawMetrics, flags) {
  const lines = [];

  if (rawMetrics?.responseTimeSec !== undefined) {
    lines.push(`${eventName}: 자극 이후 반응 개시 시간은 ${rawMetrics.responseTimeSec.toFixed(2)}초입니다.`);
  } else if (rawMetrics?.noResponse) {
    lines.push(`${eventName}: 자극 이후 의미 있는 반응이 관찰되지 않았습니다.`);
  }

  for (const f of flags) {
    if (f.code === "COLLISION_DETECTED") lines.push(`${eventName}: 충돌이 관찰되었습니다.`);
    if (f.code === "NO_RESPONSE_AFTER_STIMULUS") lines.push(`${eventName}: 자극 이후 반응이 관찰되지 않았습니다.`);
    if (f.code === "SEVERE_RESPONSE_DELAY") lines.push(`${eventName}: 반응 개시가 지연되는 양상이 관찰됩니다.`);
    if (f.code === "SCHOOLZONE_SPEED_EXCESS")
      lines.push(`${eventName}: 제한속도 초과(시간 비율/지속 시간) 양상이 관찰됩니다.`);
    if (f.code === "HARD_BRAKE_LATE_RESPONSE")
      lines.push(`${eventName}: 전방 위험(TTC 저하) 이후 제동 반응이 지연되는 양상이 관찰됩니다.`);
    if (f.code === "HARD_BRAKE_NO_RESPONSE")
      lines.push(`${eventName}: 전방 위험(TTC 저하) 상황에서 유의미한 제동 반응이 관찰되지 않았습니다.`);
    if (f.code === "PEDESTRIAN_NO_RESPONSE")
      lines.push(`${eventName}: 보행자 상황에서 감속/제동 반응이 충분하지 않았습니다.`);
    if (f.code === "RIGHTTURN_LANE_DEVIATION")
      lines.push(`${eventName}: 우회전 중 차선 중심 이탈이 크게 관찰되었습니다.`);
    if (f.code === "RIGHTTURN_CONTROL_SPIKE")
      lines.push(`${eventName}: 우회전 중 급조향(조작 급변) 양상이 관찰됩니다.`);
    if (f.code === "ULT_RISK_ENTRY_NO_YIELD")
      lines.push(`${eventName}: TTC 위험 구간이 일정 시간 이상 관찰되었으나 감속/제동(양보) 행동이 뚜렷하지 않았습니다.`);
  }

  if (lines.length > 0) {
    lines.push("위 결과는 로그 기반 객관 지표이며, 임상 소견 및 다른 검사 결과와 함께 종합 판단이 필요합니다.");
  }

  return lines;
}

export function buildReport(eventResults, globalStats, norms = {}) {
  const events = Array.isArray(eventResults) ? eventResults : [];

  const emptyEvents = events.filter((e) => e?.empty === true || (e?.rowsCount ?? 0) <= 0);
  const qc = {
    valid: emptyEvents.length < 3,
    emptyEventCount: emptyEvents.length,
    emptyEvents: emptyEvents.map((e) => ({ eventId: e.eventId, eventName: e.eventName })),
    notes: [],
  };

  if (emptyEvents.length >= 3) {
    qc.notes.push("이벤트 데이터가 충분하지 않아 일부 지표 해석에 제한이 있을 수 있습니다(이벤트 구간/트리거 설정 확인 필요).");
  }

  const eventSummaries = events.map((ev) => {
    const indicators = ev.indicators || {};
    const A = indicators.A || {};
    const B = indicators.B || {};
    const C = indicators.C || {};
    const D = indicators.D || {};
    const dbg = indicators._debug || {};
    const ult = indicators._ult || null;
    const eventMetrics = indicators._eventMetrics || null;

    const rawMetrics = {
      stimulus: B?.t0 ?? A?.t0 ?? null,
      stimulusTime: n(B?.t0?.time ?? A?.t0?.time),
      responseTimeSec: n(B?.responseTimeSec),
      noResponse: B?.severity === "NO_RESPONSE",
      responseSeverity: B?.severity ?? "NA",
      maxBrake: n(dbg?.maxBrake),
      maxSteerAbs: n(dbg?.maxSteerAbs),
      startSpeedKph: n(dbg?.v0),
      minSpeedKph: n(dbg?.minSpeed),
      ruleViolation: D?.ruleViolation === true,
      inappropriateMajor: C?.inappropriateMajor === true,

      // ✅ 이벤트별(보호구역/급정거/보행자/우회전) 지표
      eventMetrics,

      // ✅ ULT 지표
      ult,
    };

    const flags = [];
    const redFlags = Array.isArray(ev.redFlags) ? ev.redFlags : [];
    if (redFlags.some((f) => f.type === "COLLISION")) flags.push({ code: "COLLISION_DETECTED" });

    if (rawMetrics.noResponse) flags.push({ code: "NO_RESPONSE_AFTER_STIMULUS" });
    if (rawMetrics.responseSeverity === "SEVERE") flags.push({ code: "SEVERE_RESPONSE_DELAY" });

    // ✅ 보호구역 플래그
    if (ev.eventId === "schoolZone" && eventMetrics) {
      const ratio = typeof eventMetrics.exceedTimeRatio === "number" ? eventMetrics.exceedTimeRatio : 0;
      const sustain = typeof eventMetrics.maxSustainedExceedSec === "number" ? eventMetrics.maxSustainedExceedSec : 0;

      if (
        ratio >= (THRESHOLDS.schoolZoneExceedRatioFlag ?? 0.15) ||
        sustain >= (THRESHOLDS.schoolZoneSustainExceedSecFlag ?? 3.0)
      ) {
        flags.push({ code: "SCHOOLZONE_SPEED_EXCESS" });
      }
    }

    // ✅ 급정거 플래그
    if (ev.eventId === "leadVehicleHardBrake" && eventMetrics) {
      const under = typeof eventMetrics.timeUnderCriticalTTC === "number" ? eventMetrics.timeUnderCriticalTTC : 0;
      const brRT = eventMetrics.brakeReactionSec;

      const hazardEnough = under >= (THRESHOLDS.hardBrakeMinTimeUnderTtcSec ?? 0.8);

      if (hazardEnough && (brRT === undefined)) {
        flags.push({ code: "HARD_BRAKE_NO_RESPONSE" });
      } else if (hazardEnough && brRT !== undefined && brRT >= (THRESHOLDS.hardBrakeLateBrakeResponseSec ?? 1.5)) {
        flags.push({ code: "HARD_BRAKE_LATE_RESPONSE" });
      }
    }

    // ✅ 보행자 플래그(반응없음/약함)
    if (ev.eventId === "jaywalkingPedestrian" && eventMetrics) {
      const maxBrake = typeof eventMetrics.maxBrakeAfterT0 === "number" ? eventMetrics.maxBrakeAfterT0 : 0;
      const drop = typeof eventMetrics.speedDropAfterT0 === "number" ? eventMetrics.speedDropAfterT0 : 0;
      const weak =
        maxBrake < (THRESHOLDS.pedestrianMinBrakeForResponse ?? 0.1) &&
        drop < (THRESHOLDS.pedestrianMinSpeedDropKphForResponse ?? 5);

      if (weak) flags.push({ code: "PEDESTRIAN_NO_RESPONSE" });
    }

    // ✅ 우회전 플래그(차선이탈/급조향)
    if (ev.eventId === "channelizedRightTurn" && eventMetrics) {
      const off = typeof eventMetrics.maxLaneOffset === "number" ? eventMetrics.maxLaneOffset : 0;
      const steer = typeof eventMetrics.maxSteerAbs === "number" ? eventMetrics.maxSteerAbs : 0;

      if (off >= (THRESHOLDS.rightTurnLaneOffsetMajor ?? 1.2)) flags.push({ code: "RIGHTTURN_LANE_DEVIATION" });
      if (steer >= (THRESHOLDS.rightTurnSteerSpikeAbs ?? 0.8)) flags.push({ code: "RIGHTTURN_CONTROL_SPIKE" });
    }

    // ✅ ULT TTC 기반 위험진입(양보 부족) 플래그
    if (ev.eventId === "unprotectedLeftTurn" && ult) {
      const under = typeof ult.timeUnderCriticalTTC === "number" ? ult.timeUnderCriticalTTC : 0;
      const brake = typeof ult.brakeAppliedAfterT0 === "number" ? ult.brakeAppliedAfterT0 : 0;
      const drop = typeof ult.speedDropAfterT0 === "number" ? ult.speedDropAfterT0 : 0;

      const noYield =
        under >= (THRESHOLDS.ultMinTimeUnderTtcSec ?? 0.8) &&
        brake < (THRESHOLDS.ultMinBrakeForYield ?? 0.1) &&
        drop < (THRESHOLDS.ultMinSpeedDropKph ?? 5);

      if (noYield) flags.push({ code: "ULT_RISK_ENTRY_NO_YIELD" });
    }

    const flagsNormalized = flags.map((f) => ({
      code: f.code,
      severity: severityFromFlagCode(f.code),
    }));

    const clinicalText = buildClinicalText(ev.eventName, rawMetrics, flagsNormalized);

    return {
      eventId: ev.eventId,
      eventName: ev.eventName,
      qc: { empty: ev.empty === true, rowsCount: ev.rowsCount ?? 0 },
      rawMetrics,
      flags: flagsNormalized,
      comparisons: { responseTimeSec: null }, // norms는 나중에
      clinicalText,
      windows: ev.windows ?? [],
    };
  });

  const globalMetrics = {
    totalRows: globalStats?.totalRows,
    avgSpeedKph: globalStats?.avgSpeedKph,
    speedOverRatio: globalStats?.speedOverRatio,
  };

  return {
    qc,
    globalMetrics,
    eventSummaries,
    meta: {
      version: "report-v1",
      generatedAt: new Date().toISOString(),
      note: "본 결과는 로그 기반 객관 지표이며 최종 진단/판정은 의료진의 임상 판단 영역입니다.",
    },
  };
}