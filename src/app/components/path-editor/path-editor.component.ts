import {
  Component, Input, Output, EventEmitter, OnInit, OnDestroy,
  ViewChild, ElementRef, AfterViewInit, HostListener
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CalculationService } from '../../services/calculation.service';
import { PathSegment } from '../../models/calculation.model';

interface Point {
  id: number;
  x: number;  // в мм
  y: number;  // в мм
}

interface EditorSegment {
  id: number;
  type: 'line' | 'arc';
  startId: number;
  endId: number;
  // Для дуги
  radius?: number;
  angle?: number;
  direction?: 'left' | 'right';
  center?: { x: number; y: number };
}

type Tool = 'line' | 'arc' | 'select' | 'delete';

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

  @ViewChild('editorCanvas', { static: false }) canvasRef!: ElementRef<HTMLCanvasElement>;

  // Состояние редактора
  points: Point[] = [];
  segments: EditorSegment[] = [];
  private nextPointId = 1;
  private nextSegId = 1;

  // Инструмент
  currentTool: Tool = 'line';
  
  // Привязка к углам
  snapToAngle = true;
  snapAngles = [0, 45, 90, 135, 180, 225, 270, 315];
  
  // Радиус дуги по умолчанию
  defaultArcRadius = 20;

  // Рисование
  private ctx!: CanvasRenderingContext2D;
  private startPoint: Point | null = null;  // первая точка при рисовании
  private mousePos = { x: 0, y: 0 };  // позиция мыши в мм
  private mouseCanvasPos = { x: 0, y: 0 };  // позиция мыши в пикселях

  // Камера (для масштабирования)
  private camera = { x: 0, y: 0, zoom: 2 };
  private isPanning = false;
  private lastPanPos = { x: 0, y: 0 };

  // Выбор
  selectedSegment: EditorSegment | null = null;

  constructor(private calcService: CalculationService) {}

  ngOnInit(): void {
    // Восстанавливаем точки и сегменты из initialSegments
    this.reconstructFromSegments(this.initialSegments);
  }

  ngAfterViewInit(): void {
    if (this.canvasRef) {
      this.ctx = this.canvasRef.nativeElement.getContext('2d')!;
      this.resizeCanvas();
      this.setupEventListeners();
      this.draw();
    }
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.handleKeyDown);
  }

  private setupEventListeners(): void {
    document.addEventListener('keydown', this.handleKeyDown);
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (this.startPoint) {
        // Отменяем текущее рисование
        this.startPoint = null;
        this.draw();
      } else {
        this.onCancel();
      }
    }
    if (e.key === 'Delete' && this.selectedSegment) {
      this.deleteSegment(this.selectedSegment.id);
    }
  };

  @HostListener('window:resize')
  onWindowResize(): void {
    this.resizeCanvas();
    this.draw();
  }

  private resizeCanvas(): void {
    if (!this.canvasRef) return;
    const canvas = this.canvasRef.nativeElement;
    const parent = canvas.parentElement;
    if (parent) {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
      // Центрируем камеру при первом открытии
      if (this.points.length === 0) {
        this.camera.x = canvas.width / 2;
        this.camera.y = canvas.height / 2;
      }
    }
  }

  // === ПРЕОБРАЗОВАНИЕ КООРДИНАТ ===
  // Мировые (мм) -> экранные (px)
  private worldToScreen(x: number, y: number): { x: number; y: number } {
    return {
      x: this.camera.x + x * this.camera.zoom,
      y: this.camera.y - y * this.camera.zoom  // инвертируем Y (вверх = плюс)
    };
  }

  // Экранные (px) -> мировые (мм)
  private screenToWorld(px: number, py: number): { x: number; y: number } {
    return {
      x: (px - this.camera.x) / this.camera.zoom,
      y: (this.camera.y - py) / this.camera.zoom
    };
  }

  // === ОБРАБОТКА МЫШИ ===
  onMouseDown(event: MouseEvent): void {
    if (event.button === 1 || (event.button === 0 && event.altKey)) {
      // Средняя кнопка или Alt+ЛКМ - панорамирование
      this.isPanning = true;
      this.lastPanPos = { x: event.clientX, y: event.clientY };
      return;
    }

    if (event.button === 0) {
      const canvas = this.canvasRef.nativeElement;
      const rect = canvas.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const worldPos = this.screenToWorld(px, py);

      if (this.currentTool === 'select') {
        this.handleSelect(worldPos);
      } else if (this.currentTool === 'delete') {
        this.handleDeleteClick(worldPos);
      } else {
        // Рисование
        this.handleDrawClick(worldPos, event.shiftKey);
      }
    }
  }

  onMouseMove(event: MouseEvent): void {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;

    if (this.isPanning) {
      const dx = event.clientX - this.lastPanPos.x;
      const dy = event.clientY - this.lastPanPos.y;
      this.camera.x += dx;
      this.camera.y += dy;
      this.lastPanPos = { x: event.clientX, y: event.clientY };
      this.draw();
      return;
    }

    this.mouseCanvasPos = { x: px, y: py };
    this.mousePos = this.screenToWorld(px, py);

    // Применяем привязку к углам при рисовании
    if (this.startPoint && (this.currentTool === 'line' || this.currentTool === 'arc')) {
      const snapped = this.snapPosition(this.startPoint, this.mousePos, event.shiftKey);
      this.mousePos = snapped;
    }

    // Привязка к сетке
    if (!this.startPoint) {
      this.mousePos = this.snapToGrid(this.mousePos);
    }

    this.draw();
  }

  onMouseUp(event: MouseEvent): void {
    if (event.button === 1 || this.isPanning) {
      this.isPanning = false;
    }
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;

    const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
    const oldZoom = this.camera.zoom;
    this.camera.zoom = Math.max(0.5, Math.min(10, this.camera.zoom * zoomFactor));

    // Зум к курсору
    this.camera.x = px - (px - this.camera.x) * (this.camera.zoom / oldZoom);
    this.camera.y = py - (py - this.camera.y) * (this.camera.zoom / oldZoom);

    this.draw();
  }

  // === ПРИВЯЗКА И СНАП ===
  private snapToGrid(pos: { x: number; y: number }): { x: number; y: number } {
    const gridSize = 5; // 5 мм
    return {
      x: Math.round(pos.x / gridSize) * gridSize,
      y: Math.round(pos.y / gridSize) * gridSize
    };
  }

  private snapPosition(from: Point, to: { x: number; y: number }, forceSnap: boolean): { x: number; y: number } {
    if (!this.snapToAngle && !forceSnap) return to;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    let angle = Math.atan2(dy, dx) * 180 / Math.PI;

    // Привязка к ближайшему углу
    let closestAngle = angle;
    let minDiff = 360;
    for (const snapAngle of this.snapAngles) {
      let diff = Math.abs(angle - snapAngle);
      if (diff > 180) diff = 360 - diff;
      if (diff < minDiff) {
        minDiff = diff;
        closestAngle = snapAngle;
      }
    }

    // Применяем привязку только если угол близок (15°)
    if (minDiff < 15 || forceSnap) {
      const rad = closestAngle * Math.PI / 180;
      // Округляем длину до 5 мм
      const snappedDistance = Math.round(distance / 5) * 5;
      return {
        x: from.x + Math.cos(rad) * snappedDistance,
        y: from.y + Math.sin(rad) * snappedDistance
      };
    }

    // Просто округляем длину
    const snappedDistance = Math.round(distance / 5) * 5;
    const rad = angle * Math.PI / 180;
    return {
      x: from.x + Math.cos(rad) * snappedDistance,
      y: from.y + Math.sin(rad) * snappedDistance
    };
  }

  // === ЛОГИКА ИНСТРУМЕНТОВ ===
  private handleDrawClick(pos: { x: number; y: number }, shiftKey: boolean): void {
    // Ищем ближайшую точку в радиусе 10мм
    const existingPoint = this.findPointNear(pos, 10);

    if (!this.startPoint) {
      // Первая точка
      if (existingPoint) {
        this.startPoint = existingPoint;
      } else {
        const newPoint: Point = { id: this.nextPointId++, x: pos.x, y: pos.y };
        this.points.push(newPoint);
        this.startPoint = newPoint;
      }
    } else {
      // Вторая точка - создаём сегмент
      let endPoint: Point;
      if (existingPoint && existingPoint.id !== this.startPoint.id) {
        endPoint = existingPoint;
      } else if (existingPoint && existingPoint.id === this.startPoint.id) {
        // Клик в ту же точку - игнорируем
        return;
      } else {
        endPoint = { id: this.nextPointId++, x: pos.x, y: pos.y };
        this.points.push(endPoint);
      }

      if (this.currentTool === 'line') {
        this.createLineSegment(this.startPoint, endPoint);
      } else if (this.currentTool === 'arc') {
        this.createArcSegment(this.startPoint, endPoint);
      }

      // Продолжаем цепочку: конечная точка становится начальной
      this.startPoint = endPoint;
    }
    this.draw();
  }

  private handleSelect(pos: { x: number; y: number }): void {
    this.selectedSegment = this.findSegmentNear(pos, 10);
    this.draw();
  }

  private handleDeleteClick(pos: { x: number; y: number }): void {
    const seg = this.findSegmentNear(pos, 10);
    if (seg) {
      this.deleteSegment(seg.id);
    }
  }

  private findPointNear(pos: { x: number; y: number }, radius: number): Point | null {
    for (const p of this.points) {
      const dx = p.x - pos.x;
      const dy = p.y - pos.y;
      if (Math.sqrt(dx * dx + dy * dy) < radius) {
        return p;
      }
    }
    return null;
  }

  private findSegmentNear(pos: { x: number; y: number }, radius: number): EditorSegment | null {
    for (const seg of this.segments) {
      const start = this.points.find(p => p.id === seg.startId)!;
      const end = this.points.find(p => p.id === seg.endId)!;
      
      if (seg.type === 'line') {
        const dist = this.pointToLineDistance(pos, start, end);
        if (dist < radius) return seg;
      } else {
        // Для дуги упрощённо - проверяем расстояние до хорды
        const dist = this.pointToLineDistance(pos, start, end);
        if (dist < radius) return seg;
      }
    }
    return null;
  }

  private pointToLineDistance(p: { x: number; y: number }, a: Point, b: Point): number {
    const A = p.x - a.x;
    const B = p.y - a.y;
    const C = b.x - a.x;
    const D = b.y - a.y;
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = lenSq !== 0 ? dot / lenSq : -1;
    param = Math.max(0, Math.min(1, param));
    const xx = a.x + param * C;
    const yy = a.y + param * D;
    return Math.sqrt((p.x - xx) ** 2 + (p.y - yy) ** 2);
  }

  private createLineSegment(start: Point, end: Point): void {
    const seg: EditorSegment = {
      id: this.nextSegId++,
      type: 'line',
      startId: start.id,
      endId: end.id
    };
    this.segments.push(seg);
  }

  private createArcSegment(start: Point, end: Point): void {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const chordLength = Math.sqrt(dx * dx + dy * dy);
    
    if (chordLength < 1) return;  // слишком короткая хорда

    // Радиус дуги (берём больше хорды для красивого вида)
    const radius = Math.max(this.defaultArcRadius, chordLength * 0.6);
    
    // Центр дуги (сверху от хорды - по умолчанию)
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    const perpAngle = Math.atan2(dy, dx) + Math.PI / 2;
    const h = Math.sqrt(Math.max(0, radius * radius - (chordLength / 2) ** 2));
    
    const centerX = midX + Math.cos(perpAngle) * h;
    const centerY = midY + Math.sin(perpAngle) * h;

    // Угол дуги
    const startAngle = Math.atan2(start.y - centerY, start.x - centerX);
    const endAngle = Math.atan2(end.y - centerY, end.x - centerX);
    let angle = (endAngle - startAngle) * 180 / Math.PI;
    if (angle < 0) angle += 360;
    if (angle > 180) angle = 360 - angle;  // меньшая дуга

    const seg: EditorSegment = {
      id: this.nextSegId++,
      type: 'arc',
      startId: start.id,
      endId: end.id,
      radius: radius,
      angle: angle,
      direction: 'left',
      center: { x: centerX, y: centerY }
    };
    this.segments.push(seg);
  }

  deleteSegment(id: number): void {
    this.segments = this.segments.filter(s => s.id !== id);
    if (this.selectedSegment?.id === id) {
      this.selectedSegment = null;
    }
    // Удаляем точки, которые больше не используются
    this.cleanupUnusedPoints();
    this.draw();
  }

  private cleanupUnusedPoints(): void {
    const usedIds = new Set<number>();
    for (const seg of this.segments) {
      usedIds.add(seg.startId);
      usedIds.add(seg.endId);
    }
    this.points = this.points.filter(p => usedIds.has(p.id));
  }

  // === ОТРИСОВКА ===
  private draw(): void {
    if (!this.ctx || !this.canvasRef) return;
    const canvas = this.canvasRef.nativeElement;
    this.ctx.clearRect(0, 0, canvas.width, canvas.height);

    this.drawGrid();
    this.drawSegments();
    this.drawPoints();
    this.drawPreview();
    this.drawInfo();
  }

  private drawGrid(): void {
    const canvas = this.canvasRef.nativeElement;
    const gridSize = 50; // 50 мм
    const startWorld = this.screenToWorld(0, 0);
    const endWorld = this.screenToWorld(canvas.width, canvas.height);

    this.ctx.strokeStyle = '#1a2a3e';
    this.ctx.lineWidth = 1;

    const startX = Math.floor(startWorld.x / gridSize) * gridSize;
    const endX = Math.ceil(endWorld.x / gridSize) * gridSize;
    const startY = Math.floor(startWorld.y / gridSize) * gridSize;
    const endY = Math.ceil(endWorld.y / gridSize) * gridSize;

    // Вертикальные линии
    for (let x = startX; x <= endX; x += gridSize) {
      const p1 = this.worldToScreen(x, startWorld.y);
      const p2 = this.worldToScreen(x, endWorld.y);
      this.ctx.beginPath();
      this.ctx.moveTo(p1.x, p1.y);
      this.ctx.lineTo(p2.x, p2.y);
      this.ctx.stroke();
    }

    // Горизонтальные линии
    for (let y = startY; y <= endY; y += gridSize) {
      const p1 = this.worldToScreen(startWorld.x, y);
      const p2 = this.worldToScreen(endWorld.x, y);
      this.ctx.beginPath();
      this.ctx.moveTo(p1.x, p1.y);
      this.ctx.lineTo(p2.x, p2.y);
      this.ctx.stroke();
    }

    // Оси
    this.ctx.strokeStyle = '#2a4a6e';
    this.ctx.lineWidth = 2;
    const origin = this.worldToScreen(0, 0);
    this.ctx.beginPath();
    this.ctx.moveTo(origin.x, 0);
    this.ctx.lineTo(origin.x, canvas.height);
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.moveTo(0, origin.y);
    this.ctx.lineTo(canvas.width, origin.y);
    this.ctx.stroke();
  }

  private drawSegments(): void {
    for (const seg of this.segments) {
      const start = this.points.find(p => p.id === seg.startId);
      const end = this.points.find(p => p.id === seg.endId);
      if (!start || !end) continue;

      const p1 = this.worldToScreen(start.x, start.y);
      const p2 = this.worldToScreen(end.x, end.y);

      const isSelected = this.selectedSegment?.id === seg.id;
      this.ctx.strokeStyle = isSelected ? '#ffaa00' : '#ff4444';
      this.ctx.lineWidth = isSelected ? 4 : 3;

      if (seg.type === 'line') {
        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.lineTo(p2.x, p2.y);
        this.ctx.stroke();

        // Размер
        this.drawDimension(start, end);
      } else {
        // Дуга
        if (seg.center) {
          const center = this.worldToScreen(seg.center.x, seg.center.y);
          const radius = seg.radius! * this.camera.zoom;
          const startAngle = Math.atan2(start.y - seg.center.y, start.x - seg.center.x);
          const endAngle = Math.atan2(end.y - seg.center.y, end.x - seg.center.x);

          this.ctx.beginPath();
          this.ctx.arc(center.x, center.y, radius, startAngle, endAngle, false);
          this.ctx.stroke();

          // Подпись радиуса
          const midAngle = (startAngle + endAngle) / 2;
          const labelX = center.x + Math.cos(midAngle) * (radius + 15);
          const labelY = center.y + Math.sin(midAngle) * (radius + 15);
          
          this.ctx.fillStyle = '#ffaa00';
          this.ctx.font = 'bold 12px monospace';
          this.ctx.textAlign = 'center';
          this.ctx.fillText(`R${seg.radius!.toFixed(0)}`, labelX, labelY);
          this.ctx.font = '10px monospace';
          this.ctx.fillText(`${seg.angle!.toFixed(0)}°`, labelX, labelY + 12);
        }
      }
    }
  }

  private drawDimension(start: Point, end: Point): void {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;

    const p = this.worldToScreen(midX, midY);

    // Фон для текста
    const text = `${length.toFixed(0)} мм`;
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    this.ctx.font = 'bold 12px monospace';
    const textWidth = this.ctx.measureText(text).width;
    this.ctx.fillRect(p.x - textWidth / 2 - 4, p.y - 10, textWidth + 8, 16);

    // Текст
    this.ctx.fillStyle = '#fff';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(text, p.x, p.y);
  }

  private drawPoints(): void {
    for (const point of this.points) {
      const p = this.worldToScreen(point.x, point.y);
      const isStartPoint = this.startPoint?.id === point.id;

      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, isStartPoint ? 7 : 5, 0, Math.PI * 2);
      this.ctx.fillStyle = isStartPoint ? '#4caf50' : '#4a90d9';
      this.ctx.fill();
      this.ctx.strokeStyle = '#fff';
      this.ctx.lineWidth = 2;
      this.ctx.stroke();
    }
  }

  private drawPreview(): void {
    if (!this.startPoint) return;

    const p1 = this.worldToScreen(this.startPoint.x, this.startPoint.y);
    const p2 = this.worldToScreen(this.mousePos.x, this.mousePos.y);

    // Пунктирная линия предпросмотра
    this.ctx.strokeStyle = 'rgba(76, 175, 80, 0.7)';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([5, 5]);
    
    if (this.currentTool === 'line') {
      this.ctx.beginPath();
      this.ctx.moveTo(p1.x, p1.y);
      this.ctx.lineTo(p2.x, p2.y);
      this.ctx.stroke();
    } else if (this.currentTool === 'arc') {
      // Предпросмотр дуги - упрощённо
      this.ctx.beginPath();
      this.ctx.moveTo(p1.x, p1.y);
      this.ctx.lineTo(p2.x, p2.y);
      this.ctx.stroke();
    }
    
    this.ctx.setLineDash([]);

    // Подсказка с длиной
    const dx = this.mousePos.x - this.startPoint.x;
    const dy = this.mousePos.y - this.startPoint.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;

    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    this.ctx.fillRect(p2.x + 10, p2.y - 30, 120, 40);
    this.ctx.fillStyle = '#4caf50';
    this.ctx.font = 'bold 12px monospace';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';
    this.ctx.fillText(`L: ${distance.toFixed(1)} мм`, p2.x + 15, p2.y - 25);
    this.ctx.fillText(`∠: ${angle.toFixed(1)}°`, p2.x + 15, p2.y - 10);
  }

  private drawInfo(): void {
    const canvas = this.canvasRef.nativeElement;
    
    // Координаты курсора
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    this.ctx.fillRect(10, 10, 200, 25);
    this.ctx.fillStyle = '#4a90d9';
    this.ctx.font = '12px monospace';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';
    this.ctx.fillText(
      `X: ${this.mousePos.x.toFixed(1)}  Y: ${this.mousePos.y.toFixed(1)} мм`,
      15, 15
    );

    // Подсказки
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    this.ctx.fillRect(10, canvas.height - 35, 350, 25);
    this.ctx.fillStyle = '#aaa';
    this.ctx.fillText(
      'Alt+ЛКМ/СКМ: панорама | Колесо: зум | Esc: отмена | Shift: точная привязка',
      15, canvas.height - 30
    );
  }

  // === ЭКСПОРТ ===
  onSave(): void {
    if (this.segments.length === 0) {
      alert('Добавьте хотя бы один сегмент траектории');
      return;
    }
    
    // Преобразуем EditorSegment в PathSegment
    const result: PathSegment[] = [];
    for (const seg of this.segments) {
      const start = this.points.find(p => p.id === seg.startId)!;
      const end = this.points.find(p => p.id === seg.endId)!;

      if (seg.type === 'line') {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        result.push({
          id: seg.id,
          type: 'line',
          value: Math.round(length * 100) / 100,
          angle: 0,
          direction: 'left'
        });
      } else {
        result.push({
          id: seg.id,
          type: 'arc',
          value: Math.round(seg.radius! * 100) / 100,
          angle: Math.round(seg.angle! * 100) / 100,
          direction: seg.direction!
        });
      }
    }
    
    this.save.emit(result);
  }

  onCancel(): void {
    this.cancel.emit();
  }

  selectTool(tool: Tool): void {
    this.currentTool = tool;
    if (tool !== 'select') {
      this.selectedSegment = null;
    }
    this.draw();
  }

  clearAll(): void {
    if (confirm('Удалить всю траекторию?')) {
      this.points = [];
      this.segments = [];
      this.startPoint = null;
      this.selectedSegment = null;
      this.nextPointId = 1;
      this.nextSegId = 1;
      this.draw();
    }
  }

  resetView(): void {
    if (this.points.length === 0) {
      const canvas = this.canvasRef.nativeElement;
      this.camera = { x: canvas.width / 2, y: canvas.height / 2, zoom: 2 };
    } else {
      // Центрируем на всех точках
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of this.points) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const canvas = this.canvasRef.nativeElement;
      this.camera.x = canvas.width / 2 - centerX * this.camera.zoom;
      this.camera.y = canvas.height / 2 + centerY * this.camera.zoom;
    }
    this.draw();
  }

  // Восстановление из сохранённых сегментов
  private reconstructFromSegments(segments: PathSegment[]): void {
    if (segments.length === 0) return;

    let currentX = 0;
    let currentY = 0;
    let currentAngle = 0;  // направление движения

    // Первая точка
    const startPoint: Point = { id: this.nextPointId++, x: currentX, y: currentY };
    this.points.push(startPoint);
    let lastPoint = startPoint;

    for (const seg of segments) {
      let endPoint: Point;

      if (seg.type === 'line') {
        const rad = currentAngle;
        const endX = currentX + Math.cos(rad) * seg.value;
        const endY = currentY + Math.sin(rad) * seg.value;
        endPoint = { id: this.nextPointId++, x: endX, y: endY };
        this.points.push(endPoint);
        this.segments.push({
          id: this.nextSegId++,
          type: 'line',
          startId: lastPoint.id,
          endId: endPoint.id
        });
        currentX = endX;
        currentY = endY;
      } else {
        // Дуга - упрощённое восстановление
        endPoint = { id: this.nextPointId++, x: currentX + seg.value, y: currentY };
        this.points.push(endPoint);
        
        const chordLength = seg.value;
        const radius = Math.max(this.defaultArcRadius, chordLength * 0.6);
        const midX = (currentX + endPoint.x) / 2;
        const midY = (currentY + endPoint.y) / 2;
        
        this.segments.push({
          id: this.nextSegId++,
          type: 'arc',
          startId: lastPoint.id,
          endId: endPoint.id,
          radius: radius,
          angle: seg.angle,
          direction: seg.direction,
          center: { x: midX, y: midY + radius }
        });
        currentX = endPoint.x;
        currentY = endPoint.y;
      }

      lastPoint = endPoint;
    }
  }

  get totalPathLength(): number {
    let total = 0;
    for (const seg of this.segments) {
      if (seg.type === 'line') {
        const start = this.points.find(p => p.id === seg.startId)!;
        const end = this.points.find(p => p.id === seg.endId)!;
        if (start && end) {
          const dx = end.x - start.x;
          const dy = end.y - start.y;
          total += Math.sqrt(dx * dx + dy * dy);
        }
      } else if (seg.radius && seg.angle) {
        total += (seg.angle / 360) * 2 * Math.PI * seg.radius;
      }
    }
    return total;
  }
}