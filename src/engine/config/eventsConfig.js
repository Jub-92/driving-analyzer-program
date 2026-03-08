// src/engine/config/eventsConfig.js

// distanceAlongRoad 단위(미터 등)는 UC-win/Road 로그 기준으로 맞추면 됨.
// 지금은 임시값. 나중에 start/end만 수정하면 됨.

export const EVENTS_CONFIG = [
  {
    id: "schoolZone",
    name: "어린이 보호구역 감속",
    windows: [{ start: 0, end: 0 }], // TODO: 나중에 수정
  },
  {
    id: "unprotectedLeftTurn",
    name: "비보호 좌회전(ULT)",
    windows: [{ start: 0, end: 0 }], // TODO
  },
  {
    id: "jaywalkingPedestrian",
    name: "무단횡단 보행자",
    windows: [{ start: 0, end: 0 }], // TODO
  },
  {
    id: "channelizedRightTurn",
    name: "도류화 우회전",
    windows: [{ start: 0, end: 0 }], // TODO
  },
  {
    id: "leadVehicleHardBrake",
    name: "전방차량 급정거",
    windows: [{ start: 0, end: 0 }], // TODO
  },
];