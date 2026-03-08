// src/engine/config/fieldMap.js
// CSV 헤더가 조금씩 달라도 여기만 고치면 엔진은 그대로 사용 가능

export const FIELD_MAP = {
  time: ["time", "Time"],
  scenarioTime: ["scenarioTime", "ScenarioTime", "trafficTime", "TrafficTime"],

  distanceAlongRoad: ["distanceAlongRoad", "DistanceAlongRoad", "distanceAlongLatestRoad"],

  speedKph: ["speedInKmPerHour", "speedKph", "SpeedKph"],
  speedLimit: ["speedLimit", "SpeedLimit"],
  speedOver: ["speedOver", "SpeedOver"],

  steering: ["steering", "Steering", "appliedSteering", "rawSteering"],
  throttle: ["throttle", "Throttle", "appliedThrottle", "rawThrottle"],
  brake: ["brake", "Brake", "appliedBrake", "rawBrake"],

  offsetFromLaneCenter: ["offsetFromLaneCenter", "OffsetFromLaneCenter"],

  distanceToFrontVehicle: ["distanceToFrontVehicle", "DistanceToFrontVehicle"],
  ttcToFrontVehicle: ["TTCToFrontVehicle", "ttcToFrontVehicle", "TTC"],

  collisionWithUser: ["collisionWithUser", "CollisionWithUser"],
  pedestriansNumber: ["pedestriansNumber", "PedestriansNumber"],
  scenarioMessage: ["scenarioMessage", "ScenarioMessage"],
  
  yawRate: ["bodyRotSpeedInRadsPerSecond Yaw", "rotSpeedInRadsPerSecond Yaw"], // 각속도 
  roadName: ["road", "latestRoad"], // 주행 경로 기억용 
  laneOverlap: ["leftLaneOverLap", "rightLaneOverLap"], // 차선 이탈 정밀 분석 
  brakePressure: ["appliedBrake", "brake"], // 제동 답력 [cite: 43]
};

// row에서 표준 필드 하나를 찾는 함수
export function pickField(row, aliases) {
  for (const key of aliases) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  return undefined;
}