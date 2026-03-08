// src/engine/parser.js
import Papa from "papaparse";
import { FIELD_MAP, pickField } from "./config/fieldMap";

// 숫자 변환(Inf/NaN 포함) 안전 처리
function toNumber(v) {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : v; // inf 유지
  const s = String(v).trim();
  if (s.toLowerCase() === "inf" || s.toLowerCase() === "infinity") return Infinity;
  const n = Number(s);
  return Number.isNaN(n) ? undefined : n;
}

function toBool(v) {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["true", "1", "yes"].includes(s)) return true;
  if (["false", "0", "no"].includes(s)) return false;
  return undefined;
}

function toStringOrUndef(v) {
  if (v === undefined || v === null || v === "") return undefined;
  return String(v);
}

// --- 추가: BOM/공백 제거 + 키 정규화 ---
function cleanKey(k) {
  if (k === undefined || k === null) return "";
  return String(k).replace(/^\uFEFF/, "").trim();
}

function cleanRawRow(raw) {
  const out = {};
  for (const k of Object.keys(raw || {})) {
    out[cleanKey(k)] = raw[k];
  }
  return out;
}

// --- 추가: FIELD_MAP 기반 pickField가 실패할 때 대비한 직접 fallback ---
function getAny(raw, keys) {
  for (const k of keys) {
    const kk = cleanKey(k);
    if (kk in raw) return raw[kk];
  }
  return undefined;
}

// 표준 row로 정규화
export function normalizeRow(rawInput) {
  const raw = cleanRawRow(rawInput);

  // FIELD_MAP 우선, 없으면 fallback 키들로 보강
  const time = pickField(raw, FIELD_MAP.time);
  const scenarioTime = pickField(raw, FIELD_MAP.scenarioTime);

  const speedKph =
    pickField(raw, FIELD_MAP.speedKph) ??
    getAny(raw, ["speedInKmPerHour", "speedKMH", "SpeedKph", "SpeedInKmPerHour"]);

  const ttcToFrontVehicle =
    pickField(raw, FIELD_MAP.ttcToFrontVehicle) ??
    getAny(raw, ["TTCToFrontVehicle", "ttcToFrontVehicle", "TTC"]);

  const distanceAlongRoad =
    pickField(raw, FIELD_MAP.distanceAlongRoad) ??
    getAny(raw, ["distanceAlongRoad", "DistanceAlongRoad"]);

  const speedLimit =
    pickField(raw, FIELD_MAP.speedLimit) ??
    getAny(raw, ["speedLimit", "SpeedLimit"]);

  const pedestriansNumber =
    pickField(raw, FIELD_MAP.pedestriansNumber) ??
    getAny(raw, ["pedestriansNumber", "PedestriansNumber"]);

  const scenarioMessage =
    pickField(raw, FIELD_MAP.scenarioMessage) ??
    getAny(raw, ["scenarioMessage", "ScenarioMessage"]);

  return {
    time: toNumber(time),
    scenarioTime: toNumber(scenarioTime),

    distanceAlongRoad: toNumber(distanceAlongRoad),

    speedKph: toNumber(speedKph),
    speedLimit: toNumber(speedLimit),
    speedOver: toBool(pickField(raw, FIELD_MAP.speedOver)),

    steering: toNumber(pickField(raw, FIELD_MAP.steering) ?? getAny(raw, ["steering", "Steering"])),
    throttle: toNumber(pickField(raw, FIELD_MAP.throttle) ?? getAny(raw, ["throttle", "Throttle"])),
    brake: toNumber(pickField(raw, FIELD_MAP.brake) ?? getAny(raw, ["brake", "Brake"])),

    offsetFromLaneCenter: toNumber(
      pickField(raw, FIELD_MAP.offsetFromLaneCenter) ?? getAny(raw, ["offsetFromLaneCenter"])
    ),

    distanceToFrontVehicle: toNumber(
      pickField(raw, FIELD_MAP.distanceToFrontVehicle) ?? getAny(raw, ["distanceToFrontVehicle", "DistanceToFrontVehicle"])
    ),
    ttcToFrontVehicle: toNumber(ttcToFrontVehicle),

    collisionWithUser: toStringOrUndef(
      pickField(raw, FIELD_MAP.collisionWithUser) ?? getAny(raw, ["collisionWithUser"])
    ),
    pedestriansNumber: toNumber(pedestriansNumber),
    scenarioMessage: toStringOrUndef(scenarioMessage),
    yawRate: toNumber(pickField(raw, FIELD_MAP.yawRate)), // 각속도 데이터 추출
    _raw: raw,
  };
}

// File -> rows[] 파싱
export function parseCsvFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      dynamicTyping: false, // 우리가 직접 캐스팅
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const rows = (results.data || [])
            .map(normalizeRow)
            // 시간/시나리오타임이 하나도 없으면 제외
            .filter((r) => r.time !== undefined || r.scenarioTime !== undefined);

          resolve({ rows, meta: results.meta });
        } catch (e) {
          reject(e);
        }
      },
      error: (err) => reject(err),
    });
  });
}