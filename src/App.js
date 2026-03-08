// src/App.js
import React, { useMemo, useState } from "react";
import { runSingleFile } from "./engine/pipeline/runSingle";
import { runBatchFiles } from "./engine/pipeline/runBatch";
import { NORMS } from "./engine/norms";

import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Filler,
  Title,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend, Filler, Title);


/* ---------------------------- Utils ---------------------------- */

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function generateSampleCsv() {
  const headers = [
    "time",
    "scenarioTime",
    "distanceAlongRoad",
    "speedInKmPerHour",
    "speedLimit",
    "speedOver",
    "steering",
    "throttle",
    "brake",
    "offsetFromLaneCenter",
    "distanceToFrontVehicle",
    "TTCToFrontVehicle",
    "pedestriansNumber",
    "scenarioMessage",
    "collisionWithUser",
  ];

  const rows = [];
  let t = 0;
  let d = 0;
  const dt = 0.1;
  const N = 900;

  function baseRow(overrides = {}) {
    return {
      time: t.toFixed(2),
      scenarioTime: t.toFixed(2),
      distanceAlongRoad: d.toFixed(2),
      speedInKmPerHour: (overrides.speedKph ?? 50).toFixed(2),
      speedLimit: (overrides.speedLimit ?? 50).toFixed(0),
      speedOver: overrides.speedOver ? "true" : "false",
      steering: (overrides.steering ?? 0).toFixed(3),
      throttle: (overrides.throttle ?? 0.2).toFixed(3),
      brake: (overrides.brake ?? 0).toFixed(3),
      offsetFromLaneCenter: (overrides.offset ?? 0.1).toFixed(3),
      distanceToFrontVehicle: (overrides.dFront ?? 30).toFixed(2),
      TTCToFrontVehicle: overrides.ttc === undefined ? "" : String(overrides.ttc.toFixed(3)),
      pedestriansNumber: overrides.ped === undefined ? "0" : String(overrides.ped),
      scenarioMessage: overrides.msg ?? "",
      collisionWithUser: overrides.collision ?? "",
    };
  }

  for (let i = 0; i < N; i++) {
    let speedKph = 50;
    let speedLimit = 50;
    let brake = 0;
    let steering = 0;
    let offset = 0.1;
    let ttc = undefined;
    let ped = 0;
    let msg = "";
    let speedOver = false;

    if (d >= 200 && d < 300) {
      speedLimit = 30;
      speedKph = d < 260 ? 40 : 28;
      speedOver = speedKph > speedLimit;
      msg = "schoolZone";
    }

    if (d >= 320 && d < 360) {
      msg = "jaywalking";
      if (d >= 330 && d < 334) ped = 1;
      if (d >= 340) brake = 0.2;
      speedKph = d < 340 ? 45 : 30;
    }

    if (d >= 420 && d < 460) {
      msg = "ULT";
      speedKph = 35;
      if (d >= 430 && d < 440) ttc = 1.6;
      brake = 0.02;
      steering = 0.05;
    }

    if (d >= 520 && d < 560) {
      msg = "channelizedRightTurn";
      speedKph = 25;
      steering = d >= 535 && d < 540 ? 0.95 : 0.3;
      offset = d >= 540 ? 1.35 : 0.4;
    }

    if (d >= 640 && d < 680) {
      msg = "leadVehicleHardBrake";
      speedKph = 50;
      if (d >= 650 && d < 656) ttc = 1.8;
      if (d >= 660) brake = 0.25;
    }

    const r = baseRow({ speedKph, speedLimit, speedOver, steering, brake, offset, ttc, ped, msg });
    rows.push(headers.map((h) => r[h]).join(","));

    const vMs = (speedKph * 1000) / 3600;
    d += vMs * dt;
    t += dt;
  }

  return [headers.join(","), ...rows].join("\n");
}

function round(v, digits = 2) {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  const p = 10 ** digits;
  return Math.round(v * p) / p;
}

function fmt(v, digits = 2, suffix = "") {
  if (typeof v !== "number" || !Number.isFinite(v)) return "-";
  const r = round(v, digits);
  return `${r}${suffix}`;
}

function pickEventSegment(segments, eventId) {
  const hits = (segments ?? []).filter((s) => s.eventId === eventId && (s.rows?.length ?? 0) > 0);
  if (hits.length === 0) return null;
  hits.sort((a, b) => (b.rows?.length ?? 0) - (a.rows?.length ?? 0));
  return hits[0];
}

function downsampleSeries(rows, maxPoints = 180) {
  if (!rows || rows.length <= maxPoints) return rows;
  const step = Math.ceil(rows.length / maxPoints);
  const out = [];
  for (let i = 0; i < rows.length; i += step) out.push(rows[i]);
  if (out[out.length - 1] !== rows[rows.length - 1]) out.push(rows[rows.length - 1]);
  return out;
}

/* ---------------------------- Indicator Dictionary ---------------------------- */
/**
 * riskDirection:
 * - "higher-worse": 클수록 위험
 * - "lower-worse": 작을수록 위험
 * - "bool-worse": 1(Yes)이 위험 (NoResponse)
 */

const INDICATORS = [
  {
    id: "rt",
    normKey: "rt",
    label: "반응시간(Response Time)",
    unit: "s",
    riskDirection: "higher-worse",
    medical: "주의/처리속도/집행기능 저하 시 위험 자극에 대한 반응 개시가 지연될 수 있습니다.",
    traffic: "위험 자극(t0) 이후 제동/회피 행동이 시작되는 시간 지연을 의미합니다.",
    logs: "scenarioTime/time + (brake/steering/speedKph 변화)",
    how: "t0 이후 의미 있는 반응(브레이크/조향/감속)이 처음 관찰된 시점까지의 시간",
    extract: (e) => (typeof e?.rawMetrics?.responseTimeSec === "number" ? e.rawMetrics.responseTimeSec : undefined),
    format: (v) => fmt(v, 2, "s"),
  },
  {
    id: "noResponse",
    normKey: "noResponse",
    label: "무반응(No Response)",
    unit: "",
    riskDirection: "bool-worse",
    medical: "위험 인지 실패 또는 실행 기능 저하 가능성을 시사할 수 있습니다.",
    traffic: "위험 자극 이후 의미 있는 제동/회피가 관찰되지 않은 상태입니다.",
    logs: "brake/steering/speedKph",
    how: "이벤트 구간 내 반응 탐지 실패 시 true",
    extract: (e) => (e?.rawMetrics?.noResponse ? 1 : 0),
    format: (v) => (v === 1 ? "Yes" : "No"),
  },
  {
    id: "schoolZone_exceedRatio",
    normKey: "schoolZone_exceedRatio",
    label: "보호구역 초과시간 비율",
    unit: "%",
    riskDirection: "higher-worse",
    medical: "규칙 준수/주의 유지/판단 기능과 연관될 수 있습니다.",
    traffic: "제한속도 대비 의미 있는 초과가 지속된 시간 비율입니다.",
    logs: "speedKph, speedLimit",
    how: "초과 상태 누적시간 / 이벤트 구간 총시간",
    extract: (e) => e?.rawMetrics?.eventMetrics?.exceedTimeRatio,
    format: (v) => (typeof v === "number" ? `${fmt(v * 100, 1)}%` : "-"),
    onlyEventIds: ["schoolZone"],
  },
  {
    id: "schoolZone_maxExcess",
    normKey: "schoolZone_maxExcess",
    label: "보호구역 최대 초과",
    unit: "kph",
    riskDirection: "higher-worse",
    medical: "규칙 준수 저하/속도 조절 어려움과 연관될 수 있습니다.",
    traffic: "제한속도 대비 최대 초과량입니다.",
    logs: "speedKph, speedLimit",
    how: "max(speedKph - speedLimit)",
    extract: (e) => e?.rawMetrics?.eventMetrics?.maxExcessKph,
    format: (v) => fmt(v, 1, "kph"),
    onlyEventIds: ["schoolZone"],
  },
  {
    id: "schoolZone_sustain",
    normKey: "schoolZone_sustain",
    label: "보호구역 연속 초과(최대)",
    unit: "s",
    riskDirection: "higher-worse",
    medical: "주의 유지의 지속성과 연관될 수 있습니다.",
    traffic: "초과 상태가 끊기지 않고 지속된 최대 시간입니다.",
    logs: "speedKph, speedLimit, scenarioTime",
    how: "초과 조건이 연속 유지된 최대 지속 시간",
    extract: (e) => e?.rawMetrics?.eventMetrics?.maxSustainedExceedSec,
    format: (v) => fmt(v, 2, "s"),
    onlyEventIds: ["schoolZone"],
  },
  {
    id: "ttc_min",
    normKey: "ttc_min",
    label: "최소 TTC(minTTC)",
    unit: "s",
    riskDirection: "lower-worse",
    medical: "상황 예측/위험 판단 저하 시 위험 근접(TTC↓)이 증가할 수 있습니다.",
    traffic: "충돌까지 시간 여유의 최소값입니다(낮을수록 위험).",
    logs: "ttcToFrontVehicle",
    how: "이벤트 구간 내 TTC 최소값",
    extract: (e) => {
      const u = e?.rawMetrics?.ult?.minTTC;
      const h = e?.rawMetrics?.eventMetrics?.minTTC;
      return typeof u === "number" ? u : h;
    },
    format: (v) => fmt(v, 2, "s"),
    onlyEventIds: ["unprotectedLeftTurn", "leadVehicleHardBrake"],
  },
  {
    id: "ttc_under",
    normKey: "ttc_under",
    label: "위험 TTC 지속시간",
    unit: "s",
    riskDirection: "higher-worse",
    medical: "위험 근접 상태 지속은 위험 판단/대응 취약과 연관될 수 있습니다.",
    traffic: "TTC가 임계값 이하인 상태가 지속된 누적 시간입니다.",
    logs: "ttcToFrontVehicle, scenarioTime",
    how: "TTC<=critical 상태의 누적시간",
    extract: (e) => {
      const u = e?.rawMetrics?.ult?.timeUnderCriticalTTC;
      const h = e?.rawMetrics?.eventMetrics?.timeUnderCriticalTTC;
      return typeof u === "number" ? u : h;
    },
    format: (v) => fmt(v, 2, "s"),
    onlyEventIds: ["unprotectedLeftTurn", "leadVehicleHardBrake"],
  },
  {
    id: "brakeReaction",
    normKey: "brakeReaction",
    label: "제동 반응시간(위험 이후)",
    unit: "s",
    riskDirection: "higher-worse",
    medical: "반응 지연은 처리속도/집행기능 저하 가능성과 연관될 수 있습니다.",
    traffic: "위험(TTC 임계 진입) 이후 브레이크가 의미있게 들어갈 때까지의 시간입니다.",
    logs: "ttcToFrontVehicle, brake, scenarioTime",
    how: "위험 시작 이후 brake>=기준이 되는 첫 시점까지",
    extract: (e) => e?.rawMetrics?.eventMetrics?.brakeReactionSec,
    format: (v) => fmt(v, 2, "s"),
    onlyEventIds: ["leadVehicleHardBrake"],
  },
  {
    id: "ped_speedDrop",
    normKey: "ped_speedDrop",
    label: "보행자 감속량",
    unit: "kph",
    riskDirection: "higher-worse",
    medical: "자극 인지 후 회피/감속 행동의 유무를 간접적으로 볼 수 있습니다.",
    traffic: "보행자 자극 이후 최소 속도까지의 감소량입니다.",
    logs: "speedKph, scenarioTime",
    how: "speedAtT0 - minSpeedAfterT0",
    extract: (e) => e?.rawMetrics?.eventMetrics?.speedDropAfterT0,
    format: (v) => fmt(v, 1, "kph"),
    onlyEventIds: ["jaywalkingPedestrian"],
  },
  {
    id: "control_laneOffset",
    normKey: "control_laneOffset",
    label: "차선 중심 편차(최대)",
    unit: "",
    riskDirection: "higher-worse",
    medical: "조작 계획/집행 기능 취약 시 차선 유지가 불안정할 수 있습니다.",
    traffic: "회전 중 차선 중심 이탈의 최대값입니다.",
    logs: "offsetFromLaneCenter",
    how: "max(|offsetFromLaneCenter|)",
    extract: (e) => e?.rawMetrics?.eventMetrics?.maxLaneOffset,
    format: (v) => fmt(v, 2),
    onlyEventIds: ["channelizedRightTurn"],
  },
  {
    id: "control_steerSpike",
    normKey: "control_steerSpike",
    label: "급조향(max|steering|)",
    unit: "",
    riskDirection: "higher-worse",
    medical: "과도 조작/보상 조작 패턴과 연관될 수 있습니다.",
    traffic: "조향 입력의 급격한 증가(절대값 최대)입니다.",
    logs: "steering",
    how: "max(|steering|)",
    extract: (e) => e?.rawMetrics?.eventMetrics?.maxSteerAbs,
    format: (v) => fmt(v, 2),
    onlyEventIds: ["channelizedRightTurn"],
  },
  {
    id: "control_yawRate",
    normKey: "control_yawRate", // norms.js에도 나중에 추가 필요
    label: "우회전 각속도(Yaw Rate)",
    unit: "rad/s",
    riskDirection: "higher-worse",
    medical: "시공간 기능 저하 시 회전 반경 유지가 어렵고 각속도가 불안정할 수 있습니다.", // 
    extract: (e) => e?.rawMetrics?.eventMetrics?.maxYawRate,
    format: (v) => fmt(v, 3, " rad/s"),
    onlyEventIds: ["channelizedRightTurn"],
  },
];

const EVENT_INDICATOR_LIST = {
  schoolZone: ["rt", "schoolZone_exceedRatio", "schoolZone_maxExcess", "schoolZone_sustain"],
  unprotectedLeftTurn: ["noResponse", "ttc_min", "ttc_under"],
  jaywalkingPedestrian: ["rt", "ped_speedDrop", "noResponse"],
  channelizedRightTurn: ["rt", "control_laneOffset", "control_steerSpike"],
  leadVehicleHardBrake: ["rt", "ttc_min", "ttc_under", "brakeReaction"],
};

/* ---------------------------- Grade + Key KPIs ---------------------------- */

function computeOverallGrade(report) {
  const evs = report?.eventSummaries ?? [];
  const allFlags = evs.flatMap((e) => e.flags ?? []);

  let score = 0;
  for (const f of allFlags) {
    if (f.severity === "high") score += 3;
    else if (f.severity === "medium") score += 2;
    else score += 1;
  }

  const noRespCount = evs.filter((e) => e.rawMetrics?.noResponse).length;
  score += noRespCount * 2;

  let grade = "A";
  if (score >= 7) grade = "D";
  else if (score >= 4) grade = "C";
  else if (score >= 2) grade = "B";

  const summary = (() => {
    if (grade === "A") return "전반적으로 주의 신호가 거의 관찰되지 않았습니다.";
    if (grade === "B") return "일부 이벤트에서 경미한 주의 신호가 관찰되었습니다.";
    if (grade === "C") return "여러 이벤트에서 반응 지연/규칙 준수 이슈 등 주의 신호가 관찰됩니다.";
    return "고위험 또는 반복적인 주의 신호가 관찰되어 면밀한 평가가 필요합니다.";
  })();

  return { grade, score, summary };
}

function buildKeyIndicators(report) {
  const evs = report?.eventSummaries ?? [];
  const rtList = evs
    .map((e) => e.rawMetrics?.responseTimeSec)
    .filter((x) => typeof x === "number" && Number.isFinite(x));
  const meanRT = rtList.length ? rtList.reduce((a, b) => a + b, 0) / rtList.length : undefined;
  const noRespRate = evs.length ? evs.filter((e) => e.rawMetrics?.noResponse).length / evs.length : undefined;

  const sz = evs.find((e) => e.eventId === "schoolZone");
  const szRatio = sz?.rawMetrics?.eventMetrics?.exceedTimeRatio;
  const szMaxExcess = sz?.rawMetrics?.eventMetrics?.maxExcessKph;

  const ult = evs.find((e) => e.eventId === "unprotectedLeftTurn");
  const hb = evs.find((e) => e.eventId === "leadVehicleHardBrake");

  const minTTC = Math.min(
    ...([ult?.rawMetrics?.ult?.minTTC, hb?.rawMetrics?.eventMetrics?.minTTC].filter((x) => typeof x === "number" && Number.isFinite(x)))
  );
  const minTTCVal = Number.isFinite(minTTC) ? minTTC : undefined;

  const rt = evs.find((e) => e.eventId === "channelizedRightTurn");
  const laneOffset = rt?.rawMetrics?.eventMetrics?.maxLaneOffset;

  const flagsCount = evs.reduce((acc, e) => acc + (e.flags?.length ?? 0), 0);

  return [
    { label: "평균 반응시간(초)", value: meanRT !== undefined ? fmt(meanRT, 2) : "-" },
    { label: "무반응 비율", value: noRespRate !== undefined ? `${fmt(noRespRate * 100, 1)}%` : "-" },
    { label: "보호구역 초과시간 비율", value: typeof szRatio === "number" ? `${fmt(szRatio * 100, 1)}%` : "-" },
    { label: "보호구역 최대 초과(kph)", value: typeof szMaxExcess === "number" ? fmt(szMaxExcess, 1) : "-" },
    { label: "최소 TTC(초)", value: minTTCVal !== undefined ? fmt(minTTCVal, 2) : "-" },
    { label: "우회전 최대 차선편차", value: typeof laneOffset === "number" ? fmt(laneOffset, 2) : "-" },
    { label: "주의 플래그 개수", value: flagsCount },
  ];
}

/* ---------------------------- Charts ---------------------------- */

function EventCharts({ title, rows, showTTC, showSpeedLimit }) {
  const series = useMemo(() => downsampleSeries(rows, 200), [rows]);
  const t0 = series.length ? (series[0].scenarioTime ?? series[0].time ?? 0) : 0;

  const labels = series.map((r) => {
    const t = (r.scenarioTime ?? r.time ?? 0) - t0;
    return round(t, 1);
  });

  const speed = series.map((r) => (typeof r.speedKph === "number" ? r.speedKph : null));
  const brake = series.map((r) => (typeof r.brake === "number" ? r.brake : null));
  const ttc = series.map((r) => (typeof r.ttcToFrontVehicle === "number" ? r.ttcToFrontVehicle : null));
  const speedLimit = series.map((r) => (typeof r.speedLimit === "number" ? r.speedLimit : null));

  const speedData = {
    labels,
    datasets: [
      {
        label: "Speed (kph)",
        data: speed,
        borderColor: "rgba(37, 99, 235, 1)",
        backgroundColor: "rgba(37, 99, 235, 0.10)",
        tension: 0.25,
        pointRadius: 0,
        fill: true,
        yAxisID: "ySpeed",
      },
      ...(showSpeedLimit
        ? [
            {
              label: "Speed Limit",
              data: speedLimit,
              borderColor: "rgba(16, 185, 129, 1)",
              backgroundColor: "rgba(16, 185, 129, 0.10)",
              tension: 0.15,
              pointRadius: 0,
              borderDash: [6, 6],
              fill: false,
              yAxisID: "ySpeed",
            },
          ]
        : []),
    ],
  };

  const speedOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "top" },
      title: { display: true, text: title },
      tooltip: { mode: "index", intersect: false },
    },
    interaction: { mode: "index", intersect: false },
    scales: {
      x: { title: { display: true, text: "Time (s)" }, ticks: { maxTicksLimit: 8 } },
      ySpeed: { title: { display: true, text: "kph" } },
    },
  };

  const controlData = {
    labels,
    datasets: [
      {
        label: "Brake",
        data: brake,
        borderColor: "rgba(239, 68, 68, 1)",
        backgroundColor: "rgba(239, 68, 68, 0.10)",
        tension: 0.25,
        pointRadius: 0,
        fill: true,
        yAxisID: "yBrake",
      },
      ...(showTTC
        ? [
            {
              label: "TTC (s)",
              data: ttc,
              borderColor: "rgba(245, 158, 11, 1)",
              backgroundColor: "rgba(245, 158, 11, 0.10)",
              tension: 0.25,
              pointRadius: 0,
              fill: false,
              yAxisID: "yTTC",
            },
          ]
        : []),
    ],
  };

  const controlOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "top" },
      tooltip: { mode: "index", intersect: false },
    },
    interaction: { mode: "index", intersect: false },
    scales: {
      x: { title: { display: true, text: "Time (s)" }, ticks: { maxTicksLimit: 8 } },
      yBrake: { title: { display: true, text: "Brake" }, suggestedMin: 0, suggestedMax: 1 },
      ...(showTTC ? { yTTC: { position: "right", title: { display: true, text: "TTC(s)" }, suggestedMin: 0 } } : {}),
    },
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="bg-white rounded-2xl shadow p-4">
        <div className="h-64">
          <Line data={speedData} options={speedOptions} />
        </div>
      </div>
      <div className="bg-white rounded-2xl shadow p-4">
        <div className="h-64">
          <Line data={controlData} options={controlOptions} />
        </div>
      </div>
    </div>
  );
}

/* ---------------------------- Cutoff helpers ---------------------------- */

function formatCutoff(ind) {
  const key = ind.normKey;
  const n = key ? NORMS[key] : null;
  if (!n) return "NA(미설정)";

  const unit = n.unit ? ` ${n.unit}` : "";

  if (n.kind === "cutoff-rate") {
    const c = n.cautionHigh == null ? "?" : n.cautionHigh;
    const h = n.highRiskHigh == null ? "?" : n.highRiskHigh;
    return `주의 ≥ ${c}% / 고위험 ≥ ${h}%`;
  }

  if (n.kind === "cutoff-lower-worse") {
    const c = n.cautionLow == null ? "?" : n.cautionLow;
    const h = n.highRiskLow == null ? "?" : n.highRiskLow;
    return `주의 ≤ ${c}${unit} / 고위험 ≤ ${h}${unit}`;
  }

  const c = n.cautionHigh == null ? "?" : n.cautionHigh;
  const h = n.highRiskHigh == null ? "?" : n.highRiskHigh;
  return `주의 ≥ ${c}${unit} / 고위험 ≥ ${h}${unit}`;
}

function classifyByCutoff(ind, value) {
  const key = ind.normKey;
  const n = key ? NORMS[key] : null;
  if (!n || typeof value !== "number" || !Number.isFinite(value)) return "NA";

  // rate는 %로 판정
  const v = n.kind === "cutoff-rate" ? value * 100 : value;

  if (n.kind === "cutoff-lower-worse") {
    const high = n.highRiskLow;
    const cau = n.cautionLow;
    if (high != null && v <= high) return "HIGH";
    if (cau != null && v <= cau) return "CAUTION";
    return "OK";
  }

  const high = n.highRiskHigh;
  const cau = n.cautionHigh;
  if (high != null && v >= high) return "HIGH";
  if (cau != null && v >= cau) return "CAUTION";
  return "OK";
}

function pillClass(level) {
  if (level === "HIGH") return "bg-red-100 text-red-700 border-red-200";
  if (level === "CAUTION") return "bg-yellow-100 text-yellow-800 border-yellow-200";
  if (level === "OK") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  return "bg-gray-100 text-gray-700 border-gray-200"; // NA
}

/* ---------------------------- Indicator Matrix (with modes) ---------------------------- */

function safeMin(nums) {
  const v = Math.min(...nums);
  return Number.isFinite(v) ? v : undefined;
}
function safeMax(nums) {
  const v = Math.max(...nums);
  return Number.isFinite(v) ? v : undefined;
}
function safeMean(nums) {
  if (!nums.length) return undefined;
  const m = nums.reduce((a, b) => a + b, 0) / nums.length;
  return Number.isFinite(m) ? m : undefined;
}

function pickWorstEvent(valuesMap, ind, overallMode) {
  const entries = Object.entries(valuesMap).filter(([, v]) => typeof v === "number" && Number.isFinite(v));
  if (entries.length === 0) return null;

  // bool(rate) 지표는 특정 최악 이벤트를 찍기 애매해서 null (원하면 "Yes 발생 이벤트 목록"으로 확장 가능)
  if (ind.riskDirection === "bool-worse") return null;

  const mode = overallMode === "worst" ? "worst" : overallMode;

  // mean은 특정 이벤트를 고를 이유가 없어서 null
  if (mode === "mean") return null;

  let pick = entries[0];
  for (const e of entries) {
    const v = e[1];
    const best = pick[1];

    if (mode === "max") {
      if (v > best) pick = e;
    } else if (mode === "min") {
      if (v < best) pick = e;
    } else {
      // worst
      if (ind.riskDirection === "lower-worse") {
        if (v < best) pick = e;
      } else {
        if (v > best) pick = e;
      }
    }
  }
  return { eventId: pick[0], value: pick[1] };
}

/**
 * overallMode:
 * - "mean": 평균
 * - "max": 최대
 * - "min": 최소
 * - "worst": 위험방향 기준 최악값 (higher-worse -> max, lower-worse -> min)
 */
function buildIndicatorMatrix(report, overallMode = "worst") {
  const evs = report?.eventSummaries ?? [];
  const eventCols = evs.map((e) => ({ id: e.eventId, name: e.eventName }));

  const rows = INDICATORS.map((ind) => {
    const values = {};
    for (const e of evs) {
      const allowed = !ind.onlyEventIds || ind.onlyEventIds.includes(e.eventId);
      values[e.eventId] = allowed ? ind.extract(e) : undefined;
    }

    const present = Object.values(values).filter((v) => typeof v === "number" && Number.isFinite(v));

    // bool-worse: overall = rate (0~1)
    if (ind.riskDirection === "bool-worse") {
      const total = evs.length || 1;
      const sum = present.reduce((a, b) => a + b, 0);
      const rate = sum / total;
      return { ind, values, overall: rate };
    }

    let overall;
    if (overallMode === "mean") overall = safeMean(present);
    else if (overallMode === "max") overall = safeMax(present);
    else if (overallMode === "min") overall = safeMin(present);
    else {
      // worst
      overall = ind.riskDirection === "lower-worse" ? safeMin(present) : safeMax(present);
    }

    return { ind, values, overall };
  });

  const visible = rows.filter((r) => Object.values(r.values).some((v) => v !== undefined && v !== null && v !== ""));
  return { eventCols, rows: visible };
}
/* ---------------------------- New UI Components (추가된 부분) ---------------------------- */

/** 1. 종합 등급 카드: 환자가 가장 먼저 보는 화면 */
function GradeHero({ grade }) {
  const themes = {
    A: { color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200", label: "안전", icon: "✅" },
    B: { color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-200", label: "양호", icon: "ℹ️" },
    C: { color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200", label: "주의", icon: "⚠️" },
    D: { color: "text-red-600", bg: "bg-red-50", border: "border-red-200", label: "위험", icon: "🚨" },
  };
  const theme = themes[grade?.grade] || themes.B;

  return (
    <div className={`rounded-3xl border-2 ${theme.bg} ${theme.border} p-8 shadow-sm mb-6 flex flex-col md:flex-row items-center gap-8`}>
      <div className={`flex items-center justify-center min-w-[128px] h-32 rounded-full bg-white border-4 ${theme.border} shadow-lg text-6xl font-black ${theme.color}`}>
        {grade?.grade ?? "-"}
      </div>
      <div className="text-center md:text-left">
        <div className={`text-xl font-bold ${theme.color} mb-1`}>{theme.icon} 주행 적합성: {theme.label}</div>
        <h2 className="text-3xl font-extrabold text-gray-900 mb-2">{grade?.summary}</h2>
        <p className="text-gray-600 text-lg">
            인지 기능 분석 점수: <span className="font-bold text-slate-900">{grade?.score}점</span> 
            <span className="text-sm ml-2 font-normal text-slate-400">(점수가 낮을수록 안전한 상태를 의미합니다)</span>
        </p>
      </div>
    </div>
  );
}

/** 2. 고위험 징후 요약: 의료진이 바로 짚어줄 항목 */
function RiskAlert({ report }) {
  const allFlags = report?.eventSummaries?.flatMap(e => e.flags || []) || [];
  const highFlags = allFlags.filter(f => f.severity === 'high');
  if (highFlags.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl border-l-8 border-red-500 shadow-md p-6 mb-6">
      <div className="text-red-700 font-bold mb-4 flex items-center gap-2 text-lg">🚨 긴급 확인이 필요한 위험 징후 ({highFlags.length}건)</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {highFlags.map((f, i) => (
          <div key={i} className="flex items-center gap-2 bg-red-50 p-4 rounded-xl border border-red-100 text-red-900 font-bold">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            {f.code}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 3. 지표 상태 바: 표 내부의 상태를 막대로 표시 */
function StatusBar({ level, text }) {
  const colors = {
    HIGH: "bg-red-500 w-full",
    CAUTION: "bg-amber-500 w-2/3",
    OK: "bg-emerald-500 w-1/3",
    NA: "bg-gray-300 w-0"
  };
  return (
    <div className="flex flex-col gap-1.5 min-w-[100px]">
      <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-tighter">
        <div className={`w-2 h-2 rounded-full ${level === 'HIGH' ? 'bg-red-500 animate-pulse' : level === 'CAUTION' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
        <span className={level === 'HIGH' ? 'text-red-600' : level === 'CAUTION' ? 'text-amber-600' : 'text-emerald-600'}>{text}</span>
      </div>
      <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full transition-all duration-1000 ${colors[level] || "bg-gray-300"}`} />
      </div>
    </div>
  );
}
/* ---------------------------- Main App ---------------------------- */

export default function App() {
  const [mode, setMode] = useState("single");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [single, setSingle] = useState(null);
  const [batch, setBatch] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);

  const [showExpertJson, setShowExpertJson] = useState(false);
  const [showIndicatorDict, setShowIndicatorDict] = useState(true);

  const [overallMode, setOverallMode] = useState("worst"); // mean|max|min|worst

  const selectedReport = useMemo(() => {
    if (!batch || !selectedFile) return null;
    const hit = batch.results?.find((r) => r.ok && r.fileName === selectedFile);
    return hit?.report ?? null;
  }, [batch, selectedFile]);

  const resetAll = () => {
    setErrorMsg("");
    setSingle(null);
    setBatch(null);
    setSelectedFile(null);
  };

  const handleSingleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    resetAll();
    setLoading(true);

    try {
      const result = await runSingleFile(file);
      setSingle(result);
    } catch (err) {
      console.error(err);
      setErrorMsg("단일 파일 처리 중 오류가 발생했습니다. 콘솔 로그를 확인해주세요.");
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  };

  const handleBatchUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    resetAll();
    setLoading(true);

    try {
      const res = await runBatchFiles(files, { includeInvalid: false });
      setBatch(res);
      const firstOk = res.results?.find((r) => r.ok)?.fileName ?? null;
      setSelectedFile(firstOk);
    } catch (err) {
      console.error(err);
      setErrorMsg("다중 파일 처리 중 오류가 발생했습니다. 콘솔 로그를 확인해주세요.");
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  };

  const report = mode === "single" ? single?.report : selectedReport;
  const segments = mode === "single" ? single?.segments : null;

  const grade = useMemo(() => (report ? computeOverallGrade(report) : null), [report]);
  const keyIndicators = useMemo(() => (report ? buildKeyIndicators(report) : []), [report]);
  const matrix = useMemo(() => (report ? buildIndicatorMatrix(report, overallMode) : null), [report, overallMode]);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow p-6">
          <div className="text-2xl font-bold">Driving Analyzer (Clinical)</div>
          <div className="text-sm text-gray-600 mt-1">
            환자 화면: 그래프 + 설명 + 객관 지표 요약 + 종합 등급(A~D). (최종 진단/면허 판단은 의료진 영역)
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              className={`px-3 py-2 rounded-xl text-sm border ${
                mode === "single" ? "bg-gray-900 text-white border-gray-900" : "bg-white"
              }`}
              onClick={() => {
                resetAll();
                setMode("single");
              }}
            >
              단일 CSV (환자 설명)
            </button>

            <button
              className={`px-3 py-2 rounded-xl text-sm border ${
                mode === "batch" ? "bg-gray-900 text-white border-gray-900" : "bg-white"
              }`}
              onClick={() => {
                resetAll();
                setMode("batch");
              }}
            >
              다중 CSV (연구 집계)
            </button>

            <div className="ml-auto flex items-center gap-2">
              {loading && <div className="text-sm text-gray-600">처리 중...</div>}

              <button className="px-3 py-2 rounded-xl text-sm border bg-white" onClick={resetAll} disabled={loading}>
                초기화
              </button>

              <button
                className="px-3 py-2 rounded-xl text-sm border bg-white"
                onClick={() => downloadTextFile("SAMPLE_5EVENTS.csv", generateSampleCsv())}
                disabled={loading}
              >
                샘플 CSV 생성
              </button>
            </div>
          </div>

          <div className="mt-4">
            {mode === "single" ? (
              <input type="file" accept=".csv" onChange={handleSingleUpload} className="block w-full text-sm" disabled={loading} />
            ) : (
              <input type="file" accept=".csv" multiple onChange={handleBatchUpload} className="block w-full text-sm" disabled={loading} />
            )}
          </div>

          {errorMsg && <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{errorMsg}</div>}
        </div>

        {/* Summary */}
        {report && (
          <>
            <div className="bg-white rounded-2xl shadow p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-sm text-gray-600">종합 등급</div>
                  <div className="text-4xl font-extrabold mt-1">
                    {grade?.grade ?? "-"}
                    <span className="text-base font-medium text-gray-500 ml-3">score: {grade?.score ?? "-"}</span>
                  </div>
                  <div className="text-sm text-gray-700 mt-2">{grade?.summary ?? ""}</div>
                  <div className="text-xs text-gray-500 mt-2">
                    * 등급은 “객관 지표 기반 주의 수준”이며, 최종 운전 가능 여부는 의료진이 종합 판단합니다.
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 w-full md:w-auto">
                  <MiniStat label="QC" value={report?.qc?.valid ? "valid" : "invalid"} />
                  <MiniStat
                    label="Avg Speed(kph)"
                    value={typeof report?.globalMetrics?.avgSpeedKph === "number" ? fmt(report.globalMetrics.avgSpeedKph, 2) : "-"}
                  />
                  <MiniStat label="Empty Events" value={report?.qc?.emptyEventCount ?? "-"} />
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
                {keyIndicators.map((k) => (
                  <KpiCard key={k.label} label={k.label} value={k.value} />
                ))}
              </div>
            </div>

            {/* Indicator Dictionary */}
            <div className="bg-white rounded-2xl shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">이번 검사에서 사용한 평가 지표</div>
                  <div className="text-xs text-gray-600 mt-1">
                    “무엇을 평가했는지 / 어떤 로그로 계산했는지 / 어떻게 해석하는지”를 명시합니다.
                  </div>
                </div>
                <button
                  className="px-3 py-2 rounded-xl text-sm border bg-white"
                  onClick={() => setShowIndicatorDict((v) => !v)}
                >
                  {showIndicatorDict ? "접기" : "펼치기"}
                </button>
              </div>

              {showIndicatorDict && (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  {INDICATORS.filter((x) => !x.onlyEventIds).map((ind) => (
                    <div key={ind.id} className="p-4 rounded-2xl border bg-gray-50">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="font-semibold">{ind.label}</div>
                        <div className="text-xs text-gray-500">{ind.unit ? `unit: ${ind.unit}` : ""}</div>
                      </div>
                      <div className="mt-2 text-sm text-gray-700 space-y-1">
                        <div><span className="font-medium">의학적 해석:</span> {ind.medical}</div>
                        <div><span className="font-medium">교통 해석:</span> {ind.traffic}</div>
                        <div><span className="font-medium">계산:</span> {ind.how}</div>
                        <div><span className="font-medium">로그:</span> {ind.logs}</div>
                        <div><span className="font-medium">컷오프:</span> {formatCutoff(ind)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Indicator Matrix */}
            {matrix && (
              <div className="bg-white rounded-2xl shadow p-6">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <div className="font-semibold">종합 분석(지표별)</div>
                    <div className="text-xs text-gray-600 mt-1">
                      이벤트별 중복 지표를 “지표 중심”으로 모아 비교합니다(컷오프는 샘플 자리).
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="text-xs text-gray-600">Overall 요약 방식</div>
                    <select
                      className="px-3 py-2 rounded-xl text-sm border bg-white"
                      value={overallMode}
                      onChange={(e) => setOverallMode(e.target.value)}
                    >
                      <option value="worst">Worst-case(위험기준)</option>
                      <option value="mean">평균(Mean)</option>
                      <option value="max">최대(Max)</option>
                      <option value="min">최소(Min)</option>
                    </select>
                  </div>
                </div>

                {/* --- 개선된 Matrix Table --- */}
<div className="mt-4 overflow-x-auto border border-gray-200 rounded-xl shadow-sm">
  <table className="min-w-full divide-y divide-gray-200 text-sm">
    <thead className="bg-gray-50">
      <tr className="text-left text-gray-500 font-bold uppercase tracking-wider">
        {/* 'whitespace-nowrap'을 추가하여 제목이 세로로 꺾이지 않게 합니다 */}
        <th className="px-6 py-4 sticky left-0 bg-gray-50 z-20 border-r whitespace-nowrap min-w-[200px]">평가 지표</th>
        <th className="px-6 py-4 whitespace-nowrap min-w-[150px]">컷오프(기준)</th>
        <th className="px-6 py-4 text-center whitespace-nowrap">요약(OVERALL)</th>
        <th className="px-6 py-4 text-center whitespace-nowrap">상태</th>
        <th className="px-6 py-4 border-r whitespace-nowrap min-w-[180px]">취약 이벤트</th>
        {matrix.eventCols.map((c) => (
          <th key={c.id} className="px-6 py-4 text-center whitespace-nowrap min-w-[120px]">
            {c.name}
          </th>
        ))}
      </tr>
    </thead>
    <tbody className="bg-white divide-y divide-gray-100">
      {matrix.rows.map((r) => {
        const ind = r.ind;
        const level = classifyByCutoff(ind, r.overall);
        const statusText = level === "HIGH" ? "고위험" : level === "CAUTION" ? "주의" : level === "OK" ? "정상" : "NA";
        const worst = pickWorstEvent(r.values, ind, overallMode);

        return (
          <tr key={ind.id} className="hover:bg-blue-50/30 transition-colors">
            {/* 1. 지표 이름 */}
            <td className="px-6 py-5 sticky left-0 bg-white z-10 border-r font-bold text-gray-800">
              <div className="whitespace-nowrap">{ind.label}</div>
              <div className="text-[10px] font-normal text-gray-400 mt-1 uppercase tracking-tighter leading-tight">
                {ind.logs}
              </div>
            </td>

            {/* 2. 컷오프 기준 - 세로 정렬 방지 */}
            <td className="px-6 py-5 text-gray-600 leading-relaxed whitespace-pre-line min-w-[150px]">
              {formatCutoff(ind)}
            </td>

            {/* 3. 요약 수치 */}
            <td className="px-6 py-5 text-center font-black text-blue-700 text-base">
              {ind.riskDirection === "bool-worse" 
                ? (typeof r.overall === "number" ? `${fmt(r.overall * 100, 1)}%` : "-") 
                : (typeof r.overall === "number" ? ind.format(r.overall) : "-")}
            </td>

            {/* 4. 상태 배지 - 가로로 길게 표시 */}
            <td className="px-6 py-5 text-center">
              <span className={`inline-block px-3 py-1 rounded-full border text-xs font-bold whitespace-nowrap ${pillClass(level)}`}>
                {statusText}
              </span>
            </td>

            {/* 5. 취약 이벤트 */}
            <td className="px-6 py-5 border-r text-gray-500">
              {worst ? (
                <div className="min-w-[150px]">
                   <div className="font-bold text-gray-700 text-xs">{matrix.eventCols.find(x => x.id === worst.eventId)?.name}</div>
                   <div className="mt-1 text-red-500 font-medium text-[11px]">값: {ind.format(worst.value)}</div>
                </div>
              ) : "-"}
            </td>

            {/* 6. 개별 이벤트 수치들 */}
            {matrix.eventCols.map((c) => {
              const v = r.values[c.id];
              return (
                <td key={c.id} className="px-6 py-5 text-center text-gray-500 font-medium whitespace-nowrap">
                  {v === undefined ? "-" : ind.format(v)}
                </td>
              );
            })}
          </tr>
        );
      })}
    </tbody>
  </table>
</div>

                <div className="text-xs text-gray-500 mt-3">
                  * Worst-case는 지표 위험 방향을 자동 반영합니다(예: minTTC는 “작을수록 위험” → 최소값).
                  * 컷오프 값은 현재 샘플 자리이며, 추후 정상군/환자군 데이터로 보정합니다(`engine/norms.js`만 수정).
                </div>
              </div>
            )}
          </>
        )}

        {/* Single: Event cards + charts */}
        {mode === "single" && single?.report && (
          <div className="space-y-6">
            {(single.report.eventSummaries ?? []).map((e) => {
              const seg = pickEventSegment(segments, e.eventId);
              const rows = seg?.rows ?? [];
              const showTTC = e.eventId === "unprotectedLeftTurn" || e.eventId === "leadVehicleHardBrake";
              const showSpeedLimit = e.eventId === "schoolZone";
              const list = EVENT_INDICATOR_LIST[e.eventId] ?? [];

              return (
                <div key={e.eventId} className="space-y-4">
                  <div className="bg-white rounded-2xl shadow p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-xl font-bold">{e.eventName}</div>
                        <div className="text-sm text-gray-600 mt-1">
                          Rows: <span className="font-medium">{e.qc?.rowsCount ?? 0}</span>
                          <span className="mx-2">•</span>
                          RT(s):{" "}
                          <span className="font-medium">
                            {typeof e.rawMetrics?.responseTimeSec === "number" ? fmt(e.rawMetrics.responseTimeSec, 2, "s") : "-"}
                          </span>
                          <span className="mx-2">•</span>
                          No Response: <span className="font-medium">{e.rawMetrics?.noResponse ? "Yes" : "No"}</span>
                        </div>

                        <div className="mt-3 p-3 rounded-2xl bg-gray-50 border">
                          <div className="text-xs text-gray-600 font-medium">이 이벤트에서 측정한 평가 지표</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {list.length === 0 ? (
                              <span className="px-2 py-1 rounded-lg bg-white border text-xs text-gray-600">-</span>
                            ) : (
                              list.map((id) => {
                                const ind = INDICATORS.find((x) => x.id === id);
                                return (
                                  <span key={id} className="px-2 py-1 rounded-lg bg-white border text-xs text-gray-700">
                                    {ind?.label ?? id}
                                  </span>
                                );
                              })
                            )}
                          </div>
                          <div className="text-xs text-gray-500 mt-2">
                            * 지표 정의/로그/해석/컷오프는 상단 “평가 지표” 섹션에서 확인할 수 있습니다.
                          </div>
                        </div>

                        {e.clinicalText?.length > 0 && (
                          <div className="mt-3 text-sm text-gray-800 space-y-1">
                            {e.clinicalText.slice(0, 3).map((t, i) => (
                              <div key={i}>• {t}</div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {(e.flags ?? []).length === 0 ? (
                          <span className="px-2 py-1 rounded-lg bg-gray-100 text-xs text-gray-600">No flags</span>
                        ) : (
                          (e.flags ?? []).map((f, i) => (
                            <span
                              key={i}
                              className={`px-2 py-1 rounded-lg text-xs ${
                                f.severity === "high"
                                  ? "bg-red-100 text-red-700"
                                  : f.severity === "medium"
                                  ? "bg-yellow-100 text-yellow-800"
                                  : "bg-gray-100 text-gray-700"
                              }`}
                            >
                              {f.code}
                            </span>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">{renderEventMetricChips(e)}</div>
                  </div>

                  <EventCharts
                    title={`${e.eventName} (Event Timeline)`}
                    rows={rows}
                    showTTC={showTTC}
                    showSpeedLimit={showSpeedLimit}
                  />
                </div>
              );
            })}

            {/* Expert JSON */}
            <div className="bg-white rounded-2xl shadow p-6">
              <div className="flex items-center justify-between">
                <div className="font-semibold">전문가 보기 (Report JSON)</div>
                <button
                  className="px-3 py-2 rounded-xl text-sm border bg-white"
                  onClick={() => setShowExpertJson((v) => !v)}
                >
                  {showExpertJson ? "숨기기" : "펼치기"}
                </button>
              </div>
              {showExpertJson && (
                <pre className="mt-4 text-xs bg-gray-50 p-4 rounded-xl overflow-auto">{JSON.stringify(single.report, null, 2)}</pre>
              )}
            </div>
          </div>
        )}

        {/* Batch */}
        {mode === "batch" && batch && (
          <div className="bg-white rounded-2xl shadow p-6 text-sm text-gray-600">
            배치(연구 집계) 화면은 현재 유지했습니다. 원하면 “선택 파일 그래프 보기 + 지표별 표”까지 확장할 수 있어요.
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------- UI Components ---------------------------- */

function MiniStat({ label, value }) {
  return (
    <div className="p-4 rounded-xl bg-gray-50">
      <div className="text-gray-600 text-xs">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function KpiCard({ label, value }) {
  return (
    <div className="p-4 rounded-xl bg-gray-50">
      <div className="text-gray-600 text-xs">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

function renderEventMetricChips(e) {
  const chips = [];

  if (typeof e.rawMetrics?.responseTimeSec === "number") {
    chips.push({ k: "반응시간(s)", v: fmt(e.rawMetrics.responseTimeSec, 2, "s") });
  }
  chips.push({ k: "무반응", v: e.rawMetrics?.noResponse ? "Yes" : "No" });

  if (e.eventId === "schoolZone" && e.rawMetrics?.eventMetrics) {
    const m = e.rawMetrics.eventMetrics;
    if (typeof m.exceedTimeRatio === "number") chips.push({ k: "초과시간비율", v: `${fmt(m.exceedTimeRatio * 100, 1)}%` });
    if (typeof m.maxExcessKph === "number") chips.push({ k: "최대초과", v: fmt(m.maxExcessKph, 1, "kph") });
    if (typeof m.maxSustainedExceedSec === "number") chips.push({ k: "연속초과", v: fmt(m.maxSustainedExceedSec, 2, "s") });
  }

  if (e.eventId === "jaywalkingPedestrian" && e.rawMetrics?.eventMetrics) {
    const m = e.rawMetrics.eventMetrics;
    if (typeof m.speedDropAfterT0 === "number") chips.push({ k: "감속량", v: fmt(m.speedDropAfterT0, 1, "kph") });
    if (typeof m.maxBrakeAfterT0 === "number") chips.push({ k: "최대브레이크", v: fmt(m.maxBrakeAfterT0, 2) });
  }

  if (e.eventId === "channelizedRightTurn" && e.rawMetrics?.eventMetrics) {
    const m = e.rawMetrics.eventMetrics;
    if (typeof m.maxLaneOffset === "number") chips.push({ k: "차선편차", v: fmt(m.maxLaneOffset, 2) });
    if (typeof m.maxSteerAbs === "number") chips.push({ k: "급조향", v: fmt(m.maxSteerAbs, 2) });
  }

  if (e.eventId === "leadVehicleHardBrake" && e.rawMetrics?.eventMetrics) {
    const m = e.rawMetrics.eventMetrics;
    if (typeof m.minTTC === "number") chips.push({ k: "minTTC", v: fmt(m.minTTC, 2, "s") });
    if (typeof m.timeUnderCriticalTTC === "number") chips.push({ k: "위험지속", v: fmt(m.timeUnderCriticalTTC, 2, "s") });
    if (typeof m.brakeReactionSec === "number") chips.push({ k: "제동반응", v: fmt(m.brakeReactionSec, 2, "s") });
  }

  if (e.eventId === "unprotectedLeftTurn" && e.rawMetrics?.ult) {
    const u = e.rawMetrics.ult;
    if (typeof u.minTTC === "number") chips.push({ k: "minTTC", v: fmt(u.minTTC, 2, "s") });
    if (typeof u.timeUnderCriticalTTC === "number") chips.push({ k: "위험지속", v: fmt(u.timeUnderCriticalTTC, 2, "s") });
    if (typeof u.brakeAppliedAfterT0 === "number") chips.push({ k: "브레이크", v: fmt(u.brakeAppliedAfterT0, 2) });
  }

  return chips.map((c) => (
    <div key={c.k} className="px-3 py-2 rounded-xl bg-gray-50 border">
      <div className="text-xs text-gray-600">{c.k}</div>
      <div className="text-base font-semibold">{String(c.v)}</div>
    </div>
  ));
}