import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CalculationService } from './services/calculation.service';
import { CalculationParams, CalculationResult, PathSegment } from './models/calculation.model';
import { PathEditorComponent } from './components/path-editor/path-editor.component';
import { Canvas3dComponent } from './components/canvas-3d/canvas-3d.component';


@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, PathEditorComponent, Canvas3dComponent],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class AppComponent {
  params: CalculationParams = {
    width: 17,
    length: 24,
    cutterDiameter: 8,
    stepOverPercent: 25,
    depthPasses: 1,
    spindleSpeed: 8000,
    feedPerTooth: 0.03,
    numberOfTeeth: 3,
    setupTime: 0,
    isMassProduction: false,
    inputMode: 'rectangle',
    pathSegments: []
  };

  result: CalculationResult | null = null;
  showPathEditor = false;

  presets = [
    { name: 'Ø4 2з', diameter: 4, teeth: 2, feedPerTooth: 0.02 },
    { name: 'Ø6 3з', diameter: 6, teeth: 3, feedPerTooth: 0.025 },
    { name: 'Ø8 3з', diameter: 8, teeth: 3, feedPerTooth: 0.03 },
    { name: 'Ø10 4з', diameter: 10, teeth: 4, feedPerTooth: 0.04 },
    { name: 'Ø12 4з', diameter: 12, teeth: 4, feedPerTooth: 0.05 },
  ];

  constructor(private calcService: CalculationService) {}

  calculate(): void {
    if (this.params.inputMode === 'path' && this.params.pathSegments.length === 0) {
      alert('Добавьте траекторию или переключитесь на прямоугольник');
      return;
    }
    this.result = this.calcService.calculate(this.params);
  }

  applyPreset(preset: any): void {
    this.params.cutterDiameter = preset.diameter;
    this.params.numberOfTeeth = preset.teeth;
    this.params.feedPerTooth = preset.feedPerTooth;
  }

  openPathEditor(): void {
    this.showPathEditor = true;
  }

  onPathSave(segments: PathSegment[]): void {
    this.params.pathSegments = segments;
    // Автоматически обновляем длину как сумму сегментов
    this.params.length = Math.round(this.calcService.calculatePathLength(segments));
    this.showPathEditor = false;
  }

  onPathCancel(): void {
    this.showPathEditor = false;
  }

  get cuttingSpeed(): number {
    return Math.round((Math.PI * this.params.cutterDiameter * this.params.spindleSpeed) / 1000);
  }

  get pathLengthPreview(): number {
    return this.calcService.calculatePathLength(this.params.pathSegments);
  }
}