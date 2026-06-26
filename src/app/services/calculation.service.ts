import { Injectable } from '@angular/core';
import { CalculationParams, CalculationResult, PathSegment } from '../models/calculation.model';

@Injectable({ providedIn: 'root' })
export class CalculationService {

  calculate(params: CalculationParams): CalculationResult {
    // Шаг фрезы (режущая часть)
    const stepOver = params.cutterDiameter * (params.stepOverPercent / 100);
    const passesAcross = Math.ceil(params.width / stepOver);

    // Длина пути в зависимости от режима
    let pathLength: number;
    if (params.inputMode === 'rectangle') {
      pathLength = params.length;
    } else {
      pathLength = this.calculatePathLength(params.pathSegments);
    }

    // Общая длина обработки L p.x
    const rawLength = passesAcross * pathLength * params.depthPasses;
    const totalLength = Math.ceil(rawLength / 10) * 10;

    // Подача
    const feedPerRevolution = params.feedPerTooth * params.numberOfTeeth;
    const feedRate = params.spindleSpeed * feedPerRevolution;

    // Время оперативное (сырое)
    const rawOperationalTime = feedRate > 0 ? totalLength / feedRate : 0;

    // Округление по типу производства
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

  calculatePathLength(segments: PathSegment[]): number {
    return segments.reduce((total, seg) => {
      if (seg.type === 'line') {
        return total + seg.value;
      } else {
        // Длина дуги = (угол / 360) × 2πR
        const arcLength = (seg.angle / 360) * 2 * Math.PI * seg.value;
        return total + arcLength;
      }
    }, 0);
  }
}