export interface CalculationParams {
  // Плоскость
  width: number;         // Ширина детали (мм)
  length: number;        // Длина детали (мм)
  
  // Фреза
  cutterDiameter: number;    // Диаметр фрезы (мм)
  stepOverPercent: number;   // % от диаметра фрезы (шаг)
  depthPasses: number;       // Количество проходов по глубине
  
  // Режимы резания
  spindleSpeed: number;      // Обороты шпинделя n (об/мин)
  feedPerTooth: number;      // Подача на зуб Sz (мм/зуб)
  numberOfTeeth: number;     // Количество зубьев фрезы
  
  // Время
  setupTime: number;         // Т вс - вспомогательное время (мин)
}

export interface CalculationResult {
  stepOver: number;           // Режущая часть фрезы (мм)
  passesAcross: number;       // Количество проходов по ширине
  totalLength: number;        // L p.x - общая длина проходов (мм)
  feedPerRevolution: number;  // S об - подача на оборот (мм/об)
  feedRate: number;           // S мин - подача в минуту (мм/мин)
  operationalTime: number;    // То - оперативное время (мин)
  totalTime: number;          // Общее время (мин)
}

export interface DrawnPath {
  points: { x: number; y: number }[];
  width: number;
}