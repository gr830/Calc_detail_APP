import { Injectable } from '@angular/core';
import { CalculationParams, CalculationResult, PathSegment } from '../models/calculation.model';

@Injectable({ providedIn: 'root' })
export class CalculationService {

  calculate(params: CalculationParams): CalculationResult {
    // 1. Шаг фрезы (режущая часть)
    const stepOver = params.cutterDiameter * (params.stepOverPercent / 100);
    const passesAcross = Math.ceil(params.width / stepOver);

    // 2. Длина пути в зависимости от режима (Прямоугольник или Траектория)
    let pathLength: number;
    if (params.inputMode === 'rectangle') {
      pathLength = params.length;
    } else {
      // Если выбрана траектория, динамически высчитываем её длину
      pathLength = this.calculatePathLength(params.pathSegments);
    }

    // 3. Общая длина обработки L p.x (с округлением до десятков)
    const rawLength = passesAcross * pathLength * params.depthPasses;
    const totalLength = Math.ceil(rawLength / 10) * 10;

    // 4. Минутная подача
    const feedPerRevolution = params.feedPerTooth * params.numberOfTeeth;
    const feedRate = params.spindleSpeed * feedPerRevolution;

    // 5. Оперативное время (сырое, с защитой от деления на 0)
    const rawOperationalTime = feedRate > 0 ? totalLength / feedRate : 0;

    // 6. Округление по типу производства
    const roundingStep = params.isMassProduction ? 0.1 : 0.05;
    const operationalTime = Math.ceil(rawOperationalTime / roundingStep) * roundingStep;

    const totalTime = operationalTime + params.setupTime;

    return {
      stepOver: Math.round(stepOver * 100) / 100,
      passesAcross,
      totalLength,
      feedPerRevolution: Math.round(feedPerRevolution * 1000) / 1000,
      feedRate: Math.round(feedRate * 100) / 100,
      operationalTime: Math.round(operationalTime * 1000) / 1000,
      operationalTimeRaw: Math.round(rawOperationalTime * 10000) / 10000,
      totalTime: Math.round(totalTime * 1000) / 1000,
      roundingStep
    };
  }

  // Вспомогательный метод для расчета суммарной длины траектории
  calculatePathLength(segments: PathSegment[]): number {
    return segments.reduce((total, seg) => {
      if (seg.type === 'line') {
        return total + seg.value;
      } else {
        // Длина дуги = (Угол / 360) × 2πR
        const arcLength = (seg.angle / 360) * 2 * Math.PI * seg.value;
        return total + arcLength;
      }
    }, 0);
  }
}