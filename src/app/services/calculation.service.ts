import { Injectable } from '@angular/core';
import { CalculationParams, CalculationResult } from '../models/calculation.model';

@Injectable({
  providedIn: 'root'
})
export class CalculationService {

  calculate(params: CalculationParams): CalculationResult {
    // 1. Режущая часть фрезы (шаг между проходами)
    // Берём 25% от диаметра фрезы
    const stepOver = params.cutterDiameter * (params.stepOverPercent / 100);

    // 2. Количество проходов по ширине
    // Делим ширину на шаг и округляем вверх
    const passesAcross = Math.ceil(params.width / stepOver);

    // 3. Общая длина обработки (L p.x)
    // Умножаем количество проходов на длину
    // Учитываем количество проходов по глубине
    const rawLength = passesAcross * params.length * params.depthPasses;
    // Округляем вверх до ближайшего 10
    const totalLength = Math.ceil(rawLength / 10) * 10;

    // 4. Подача на оборот (S об)
    const feedPerRevolution = params.feedPerTooth * params.numberOfTeeth;

    // 5. Подача в минуту (S мин)
    // S мин = n * S об
    const feedRate = params.spindleSpeed * feedPerRevolution;

    // 6. Оперативное время (То)
    // То = L p.x / S мин
    const operationalTime = feedRate > 0 ? totalLength / feedRate : 0;

    // 7. Общее время
    const totalTime = operationalTime + params.setupTime;

    return {
      stepOver: Math.round(stepOver * 100) / 100,
      passesAcross,
      totalLength,
      feedPerRevolution: Math.round(feedPerRevolution * 1000) / 1000,
      feedRate: Math.round(feedRate * 100) / 100,
      operationalTime: Math.round(operationalTime * 1000) / 1000,
      totalTime: Math.round(totalTime * 1000) / 1000
    };
  }
}