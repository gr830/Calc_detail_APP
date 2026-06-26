export interface PathSegment {
  id: number;
  type: 'line' | 'arc';
  value: number;                    // длина (line) или радиус (arc) в мм
  angle: number;                    // угол дуги в градусах (для arc)
  direction: 'left' | 'right';      // направление дуги
}

export interface CalculationParams {
  width: number;
  length: number;
  cutterDiameter: number;
  stepOverPercent: number;
  depthPasses: number;
  spindleSpeed: number;
  feedPerTooth: number;
  numberOfTeeth: number;
  setupTime: number;
  isMassProduction: boolean;        // ← НОВОЕ
  inputMode: 'rectangle' | 'path';  // ← НОВОЕ
  pathSegments: PathSegment[];      // ← НОВОЕ
}

export interface CalculationResult {
  stepOver: number;
  passesAcross: number;
  totalLength: number;
  feedPerRevolution: number;
  feedRate: number;
  operationalTime: number;          // Округлённое значение
  operationalTimeRaw: number;        // До округления
  totalTime: number;
  roundingStep: number;             // Шаг округления (0.05 или 0.1)
}