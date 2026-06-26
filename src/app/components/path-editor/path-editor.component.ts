import {
  Component, Input, Output, EventEmitter, OnInit, OnDestroy,
  ViewChild, ElementRef, AfterViewInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CalculationService } from '../../services/calculation.service';
import { PathSegment } from '../../models/calculation.model';

@Component({
  selector: 'app-path-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './path-editor.component.html',
  styleUrls: ['./path-editor.component.css']
})
export class PathEditorComponent implements OnInit, OnDestroy, AfterViewInit {
  @Input() initialSegments: PathSegment[] = [];
  @Input() width: number = 17;
  @Output() save = new EventEmitter<PathSegment[]>();
  @Output() cancel = new EventEmitter<void>();

  @ViewChild('previewCanvas', { static: false }) canvasRef!: ElementRef<HTMLCanvasElement>;

  segments: PathSegment[] = [];
  private nextId = 1;

  // Форма добавления
  newType: 'line' | 'arc' = 'line';
  newValue: number = 100;
  newAngle: number = 90;
  newDirection: 'left' | 'right' = 'left';

  // Состояние отрисовки
  private ctx!: CanvasRenderingContext2D;
  private scale = 2; // пикселей на мм

  constructor(private calcService: CalculationService) {}

  ngOnInit(): void {
    this.segments = this.initialSegments.map(s => ({ ...s }));
    this.nextId = this.segments.length > 0 
      ? Math.max(...this.segments.map(s => s.id)) + 1 
      : 1;
  }

  ngAfterViewInit(): void {
    if (this.canvasRef) {
      this.ctx = this.canvasRef.nativeElement.getContext('2d')!;
      this.resizeCanvas();
      this.drawPath();
    }
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.handleEsc);
  }

  private handleEsc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.onCancel();
  };

  private resizeCanvas(): void {
    if (!this.canvasRef) return;
    const canvas = this.canvasRef.nativeElement;
    const parent = canvas.parentElement;
    if (parent) {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    }
  }

  addSegment(): void {
    const segment: PathSegment = {
      id: this.nextId++,
      type: this.newType,
      value: this.newValue,
      angle: this.newType === 'arc' ? this.newAngle : 0,
      direction: this.newDirection
    };
    this.segments.push(segment);
    this.drawPath();
  }

  removeSegment(id: number): void {
    this.segments = this.segments.filter(s => s.id !== id);
    this.drawPath();
  }

  moveSegment(id: number, direction: 'up' | 'down'): void {
    const idx = this.segments.findIndex(s => s.id === id);
    if (idx < 0) return;
    
    if (direction === 'up' && idx > 0) {
      [this.segments[idx], this.segments[idx - 1]] = [this.segments[idx - 1], this.segments[idx]];
    } else if (direction === 'down' && idx < this.segments.length - 1) {
      [this.segments[idx], this.segments[idx + 1]] = [this.segments[idx + 1], this.segments[idx]];
    }
    this.drawPath();
  }

  onSave(): void {
    if (this.segments.length === 0) {
      alert('Добавьте хотя бы один сегмент траектории');
      return;
    }
    this.save.emit([...this.segments]);
  }

  onCancel(): void {
    this.cancel.emit();
  }

  // === ОТРИСОВКА ПУТИ ===
  private drawPath(): void {
    if (!this.ctx || !this.canvasRef) return;
    const canvas = this.canvasRef.nativeElement;
    this.ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Фон-сетка
    this.drawGrid();

    if (this.segments.length === 0) {
      this.ctx.fillStyle = '#666';
      this.ctx.font = '14px monospace';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('Добавьте сегменты слева', canvas.width / 2, canvas.height / 2);
      return;
    }

    // Рисуем заготовку (ширина)
    const totalLength = this.calcService.calculatePathLength(this.segments);
    this.scale = Math.min(
      (canvas.width - 80) / (totalLength + 20),
      (canvas.height - 80) / (this.width + 20)
    );

    const startX = 40;
    const centerY = canvas.height / 2;

    // Отрисовка ширины детали (прямоугольник)
    this.ctx.fillStyle = 'rgba(74, 144, 217, 0.15)';
    this.ctx.fillRect(
      startX,
      centerY - (this.width * this.scale) / 2,
      totalLength * this.scale,
      this.width * this.scale
    );
    this.ctx.strokeStyle = '#4a90d9';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(
      startX,
      centerY - (this.width * this.scale) / 2,
      totalLength * this.scale,
      this.width * this.scale
    );

    // Центральная линия траектории
    this.ctx.strokeStyle = '#ff4444';
    this.ctx.lineWidth = 3;
    this.ctx.beginPath();

    let x = startX;
    let y = centerY;
    let currentAngle = 0; // направление движения (0 = вправо)

    this.ctx.moveTo(x, y);

    for (const seg of this.segments) {
      if (seg.type === 'line') {
        const dx = Math.cos(currentAngle) * seg.value * this.scale;
        const dy = Math.sin(currentAngle) * seg.value * this.scale;
        x += dx;
        y += dy;
        this.ctx.lineTo(x, y);
      } else {
        // Дуга
        const radius = seg.value * this.scale;
        const angleRad = (seg.angle * Math.PI) / 180;
        const sign = seg.direction === 'left' ? -1 : 1;
        const centerAngle = currentAngle + sign * Math.PI / 2;
        const cx = x + Math.cos(centerAngle) * radius;
        const cy = y + Math.sin(centerAngle) * radius;

        const startAngle = centerAngle + Math.PI + (seg.direction === 'left' ? 0 : Math.PI);
        const endAngle = startAngle + sign * angleRad;

        this.ctx.arc(cx, cy, radius, startAngle, endAngle, seg.direction === 'right');
        
        x = cx + Math.cos(endAngle) * radius;
        y = cy + Math.sin(endAngle) * radius;
        currentAngle += sign * angleRad;
      }
    }
    this.ctx.stroke();

    // Подпись общей длины
    this.ctx.fillStyle = '#fff';
    this.ctx.font = 'bold 14px monospace';
    this.ctx.textAlign = 'left';
    this.ctx.fillText(
      `Общая длина: ${totalLength.toFixed(2)} мм`,
      10,
      canvas.height - 10
    );
  }

  private drawGrid(): void {
    const canvas = this.canvasRef.nativeElement;
    this.ctx.strokeStyle = '#1a2a3e';
    this.ctx.lineWidth = 0.5;
    const step = 40;
    for (let x = 0; x < canvas.width; x += step) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, canvas.height);
      this.ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += step) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(canvas.width, y);
      this.ctx.stroke();
    }
  }

  getSegmentLength(seg: PathSegment): number {
    if (seg.type === 'line') return seg.value;
    return (seg.angle / 360) * 2 * Math.PI * seg.value;
  }

  get totalPathLength(): number {
    return this.calcService.calculatePathLength(this.segments);
  }
}