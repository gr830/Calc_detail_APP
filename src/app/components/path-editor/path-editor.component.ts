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
  x: number;
  y: number;
}

interface LineSegment {
  id: number;
  type: 'line';
  startId: number;
  endId: number;
}

interface ArcSegment {
  id: number;
  type: 'arc';
  startId: number;
  endId: number;
  center: { x: number; y: number };
  radius: number;
  startAngle: number;
  endAngle: number;
  sweepAngle: number;
  arcLength: number; 
  ccw: boolean;
}

type Segment = LineSegment | ArcSegment;

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

  points: Point[] = [];
  segments: Segment[] = [];
  private nextId = 1;
  
  arcMode: 'angle' | 'length' = 'angle';
  arcArcLength = 50; 

  currentPoint: Point | null = null;
  currentTangent = 0;

  tool: 'line' | 'arc' = 'line';

  // ПАРАМЕТРЫ ЛИНИИ
  lineLength = 100;
  lineAngle = 0;
  
  // ПАРАМЕТРЫ ДУГИ
  arcRadius = 20; 
  arcAngle = 90;  
  arcDirection: 'left' | 'right' = 'left';

  // ЗАМОЧКИ
  lockLineLength = false;
  lockLineAngle = false;
  lockArcRadius = false;
  lockArcAngle = false;
  lockArcDirection = false;

  selectedSegment: Segment | null = null;

  cursorWorld = { x: 0, y: 0 };
  snappedCursor = { x: 0, y: 0 };
  currentSnap: { kind: string; point: { x: number; y: number } } | null = null;

  snapEndpoint = true;
  snapMidpoint = true;
  orthoMode = false;

  private camera = { x: 0, y: 0, zoom: 2 };
  private isPanning = false;
  private lastPanPos = { x: 0, y: 0 };

  private history: { points: Point[]; segments: Segment[]; currentPoint: Point | null; currentTangent: number }[] = [];

  private ctx!: CanvasRenderingContext2D;

  constructor(private calcService: CalculationService) {}

  ngOnInit(): void {
    this.reconstructFromSegments(this.initialSegments);
  }

  ngAfterViewInit(): void {
    if (this.canvasRef) {
      this.ctx = this.canvasRef.nativeElement.getContext('2d')!;
      this.resizeCanvas();
      this.draw();
    }
  }

  ngOnDestroy(): void {}

  @HostListener('window:resize')
  onWindowResize(): void {
    this.resizeCanvas();
    this.draw();
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const isInput = target.tagName === 'INPUT';

    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); this.undo(); return; }
    if (e.key === 'Escape') { this.cancelDrawing(); return; }
    if (e.key === 'F8') { e.preventDefault(); this.orthoMode = !this.orthoMode; this.draw(); return; }
    
    if (e.key === 'Enter' && this.currentPoint && !isInput) {
      e.preventDefault();
      this.createSegmentFromParams();
    }

    if (!isInput) {
      const k = e.key.toLowerCase();
      if (k === 'l') { this.setTool('line'); return; }
      if (k === 'a') { this.setTool('arc'); return; }
      if (k === 'delete' && this.selectedSegment) { this.deleteSelected(); return; }
    }
  };

  private resizeCanvas(): void {
    if (!this.canvasRef) return;
    const canvas = this.canvasRef.nativeElement;
    const parent = canvas.parentElement;
    if (parent) {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
      if (this.points.length === 0 && this.camera.x === 0) {
        this.camera.x = canvas.width / 2;
        this.camera.y = canvas.height / 2;
      }
    }
  }

  private worldToScreen(x: number, y: number): { x: number; y: number } {
    return {
      x: this.camera.x + x * this.camera.zoom,
      y: this.camera.y - y * this.camera.zoom
    };
  }

  private screenToWorld(px: number, py: number): { x: number; y: number } {
    return {
      x: (px - this.camera.x) / this.camera.zoom,
      y: (this.camera.y - py) / this.camera.zoom
    };
  }

  onMouseDown(event: MouseEvent): void {
    if (event.button === 1 || (event.button === 0 && event.altKey)) {
      this.isPanning = true;
      this.lastPanPos = { x: event.clientX, y: event.clientY };
      return;
    }

    if (event.button === 0) {
      const canvas = this.canvasRef.nativeElement;
      const rect = canvas.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      this.handleCanvasClick(px, py);
    }
  }

  onMouseMove(event: MouseEvent): void {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;

    if (this.isPanning) {
      this.camera.x += event.clientX - this.lastPanPos.x;
      this.camera.y += event.clientY - this.lastPanPos.y;
      this.lastPanPos = { x: event.clientX, y: event.clientY };
      this.draw();
      return;
    }

    this.cursorWorld = this.screenToWorld(px, py);
    this.currentSnap = this.findSnap(px, py);
    this.snappedCursor = this.currentSnap ? { ...this.currentSnap.point } : this.snapToGrid(this.cursorWorld);

    if (this.currentPoint) {
      const dx = this.snappedCursor.x - this.currentPoint.x;
      const dy = this.snappedCursor.y - this.currentPoint.y;
      const dist = Math.hypot(dx, dy);

      if (this.tool === 'line' && dist > 0.1) {
        if (!this.lockLineLength) {
          this.lineLength = Math.round(dist * 100) / 100;
        }
        if (!this.lockLineAngle) {
          let ang = Math.atan2(dy, dx) * 180 / Math.PI;
          if (ang < 0) ang += 360;
          this.lineAngle = Math.round(ang * 100) / 100;
        }
        
      } else if (this.tool === 'arc' && dist > 0.1) {
        const chordAngle = Math.atan2(dy, dx);
        const tangentRad = this.currentTangent * Math.PI / 180;
        
        let alpha = chordAngle - tangentRad;
        while (alpha > Math.PI) alpha -= 2 * Math.PI;
        while (alpha <= -Math.PI) alpha += 2 * Math.PI;

        // Защита от бесконечного радиуса
        if (Math.abs(alpha) < 0.05 || Math.abs(Math.abs(alpha) - Math.PI) < 0.05) {
           this.draw();
           return; 
        }

        // КАРТЕЗИАНСКИЙ МАППИНГ: alpha > 0 — это левый поворот (CCW) в декартовой системе Y-up
        if (!this.lockArcDirection) {
           this.arcDirection = alpha > 0 ? 'left' : 'right';
        }

        const isLeft = this.arcDirection === 'left';

        if (!this.lockArcRadius && !this.lockArcAngle) {
          const R = Math.abs(dist / (2 * Math.sin(alpha)));
          if (R < 10000) { 
            this.arcRadius = Math.round(R * 100) / 100;
            const sweepRad = 2 * Math.abs(alpha);
            
            if (this.arcMode === 'angle') {
              this.arcAngle = Math.round((sweepRad * 180 / Math.PI) * 100) / 100;
            } else {
              this.arcArcLength = Math.round(this.arcRadius * sweepRad * 100) / 100;
            }
          }
        } 
        else if (this.lockArcRadius && !this.lockArcAngle) {
          let safeDist = Math.min(dist, this.arcRadius * 2);
          let sweepRad = 2 * Math.asin(safeDist / (2 * this.arcRadius));
          
          if ((alpha > 0 && !isLeft) || (alpha < 0 && isLeft)) {
             sweepRad = 2 * Math.PI - sweepRad;
          }

          if (this.arcMode === 'angle') {
            this.arcAngle = Math.round((sweepRad * 180 / Math.PI) * 100) / 100;
          } else {
            this.arcArcLength = Math.round(this.arcRadius * sweepRad * 100) / 100;
          }
        }
        else if (!this.lockArcRadius && this.lockArcAngle) {
          let sweepRad = this.arcMode === 'angle' ? this.arcAngle * Math.PI / 180 : (this.arcArcLength / this.arcRadius);
          if (sweepRad > 0) {
             const R = dist / (2 * Math.sin(sweepRad / 2));
             this.arcRadius = Math.round(R * 100) / 100;
          }
        }
      }
    }

    this.draw();
  }

  onMouseUp(event: MouseEvent): void {
    if (this.isPanning) this.isPanning = false;
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;

    const factor = event.deltaY > 0 ? 0.9 : 1.1;
    const oldZoom = this.camera.zoom;
    this.camera.zoom = Math.max(0.3, Math.min(15, this.camera.zoom * factor));
    this.camera.x = px - (px - this.camera.x) * (this.camera.zoom / oldZoom);
    this.camera.y = py - (py - this.camera.y) * (this.camera.zoom / oldZoom);
    this.draw();
  }

  onContextMenu(event: MouseEvent): void {
    event.preventDefault();
  }

  private snapToGrid(pos: { x: number; y: number }): { x: number; y: number } {
    const g = 5;
    return {
      x: Math.round(pos.x / g) * g,
      y: Math.round(pos.y / g) * g
    };
  }

  private findSnap(px: number, py: number): { kind: string; point: { x: number; y: number } } | null {
    const r = 8;
    if (this.snapEndpoint) {
      for (const p of this.points) {
        const sp = this.worldToScreen(p.x, p.y);
        if (Math.hypot(sp.x - px, sp.y - py) < r) {
          return { kind: 'endpoint', point: p };
        }
      }
    }
    if (this.snapMidpoint) {
      for (const seg of this.segments) {
        if (seg.type === 'line') {
          const s = this.points.find(p => p.id === seg.startId);
          const e = this.points.find(p => p.id === seg.endId);
          if (s && e) {
            const mid = { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 };
            const sp = this.worldToScreen(mid.x, mid.y);
            if (Math.hypot(sp.x - px, sp.y - py) < r) {
              return { kind: 'midpoint', point: mid };
            }
          }
        }
      }
    }
    return null;
  }

  private handleCanvasClick(px: number, py: number): void {
    const pos = this.currentSnap ? { ...this.currentSnap.point } : this.snappedCursor;

    if (!this.currentPoint) {
      this.pushHistory();
      this.currentPoint = this.findOrCreatePoint(pos);
      this.currentTangent = 0;
      this.draw();
    } else {
      this.createSegmentFromParams();
    }
  }

  private findOrCreatePoint(pos: { x: number; y: number }): Point {
    for (const p of this.points) {
      if (Math.hypot(p.x - pos.x, p.y - pos.y) < 0.1) return p;
    }
    const np: Point = { id: this.nextId++, x: pos.x, y: pos.y };
    this.points.push(np);
    return np;
  }

  createSegmentFromParams(): void {
    if (!this.currentPoint) return;
    this.pushHistory();

    if (this.tool === 'line') {
      if (this.lineLength < 0.1) return; 
      this.createLineFromCurrentPoint();
    } else {
      if (this.arcRadius < 0.1) return;
      this.createArcFromCurrentPoint();
    }
    
    this.resetLocks();
    this.draw();
  }

  private createLineFromCurrentPoint(): void {
    const rad = this.lineAngle * Math.PI / 180;
    const endX = this.currentPoint!.x + Math.cos(rad) * this.lineLength;
    const endY = this.currentPoint!.y + Math.sin(rad) * this.lineLength;

    const endPoint: Point = { id: this.nextId++, x: endX, y: endY };
    this.points.push(endPoint);

    this.segments.push({
      id: this.nextId++,
      type: 'line',
      startId: this.currentPoint!.id,
      endId: endPoint.id
    });

    this.currentPoint = endPoint;
    this.currentTangent = this.lineAngle;
  }

  private createArcFromCurrentPoint(): void {
    const R = this.arcRadius;
    let turnAngleDeg = 0;
    let arcLen = 0;

    if (this.arcMode === 'angle') {
      turnAngleDeg = this.arcAngle;
      arcLen = R * (turnAngleDeg * Math.PI / 180);
    } else {
      arcLen = this.arcArcLength;
      turnAngleDeg = (arcLen / R) * (180 / Math.PI);
    }

    const turnRad = turnAngleDeg * Math.PI / 180;
    const tangentRad = this.currentTangent * Math.PI / 180;

    // ВАЖНЫЙ ФИКС: Лево CCW — это всегда +1 в классической математике!
    const dir = this.arcDirection === 'left' ? 1 : -1; 

    const normalRad = tangentRad + dir * (Math.PI / 2);
    const centerX = this.currentPoint!.x + R * Math.cos(normalRad);
    const centerY = this.currentPoint!.y + R * Math.sin(normalRad);

    const startAngle = normalRad + Math.PI; 
    const endAngle = startAngle + dir * turnRad;

    const endX = centerX + R * Math.cos(endAngle);
    const endY = centerY + R * Math.sin(endAngle);

    const endPoint: Point = { id: this.nextId++, x: endX, y: endY };
    this.points.push(endPoint);

    this.segments.push({
      id: this.nextId++,
      type: 'arc',
      startId: this.currentPoint!.id,
      endId: endPoint.id,
      center: { x: centerX, y: centerY },
      radius: R,
      startAngle: startAngle,
      endAngle: endAngle,
      sweepAngle: turnAngleDeg,
      arcLength: arcLen,
      ccw: this.arcDirection === 'left'
    });

    this.currentPoint = endPoint;
    this.currentTangent = this.currentTangent + dir * turnAngleDeg;

    while (this.currentTangent < 0) this.currentTangent += 360;
    while (this.currentTangent >= 360) this.currentTangent -= 360;
  }

  cancelDrawing(): void {
    if (this.currentPoint && this.segments.length === 0) {
      this.points = this.points.filter(p => p.id !== this.currentPoint!.id);
    }
    this.currentPoint = null;
    this.currentTangent = 0;
    this.selectedSegment = null;
    this.resetLocks();
    this.draw();
  }

  deleteSelected(): void {
    if (this.selectedSegment) {
      this.pushHistory();
      this.segments = this.segments.filter(s => s.id !== this.selectedSegment!.id);
      this.selectedSegment = null;
      this.cleanupUnusedPoints();
      this.draw();
    }
  }

  private cleanupUnusedPoints(): void {
    const used = new Set<number>();
    this.segments.forEach(s => { used.add(s.startId); used.add(s.endId); });
    this.points = this.points.filter(p => used.has(p.id));
  }

  private pushHistory(): void {
    this.history.push({
      points: JSON.parse(JSON.stringify(this.points)),
      segments: JSON.parse(JSON.stringify(this.segments)),
      currentPoint: this.currentPoint ? { ...this.currentPoint } : null,
      currentTangent: this.currentTangent
    });
    if (this.history.length > 50) this.history.shift();
  }

  undo(): void {
    const last = this.history.pop();
    if (last) {
      this.points = last.points;
      this.segments = last.segments;
      this.currentPoint = last.currentPoint;
      this.currentTangent = last.currentTangent;
      this.selectedSegment = null;
      this.draw();
    }
  }

  selectSegmentFromList(seg: Segment): void {
    this.selectedSegment = seg;
    this.draw();
  }

  getSegmentLength(seg: Segment): number {
    if (seg.type === 'line') {
      const s = this.points.find(p => p.id === seg.startId)!;
      const e = this.points.find(p => p.id === seg.endId)!;
      return Math.hypot(e.x - s.x, e.y - s.y);
    } else {
      return seg.arcLength;
    }
  }

  getSegmentAngle(seg: Segment): number {
    if (seg.type === 'line') {
      const s = this.points.find(p => p.id === seg.startId)!;
      const e = this.points.find(p => p.id === seg.endId)!;
      let ang = Math.atan2(e.y - s.y, e.x - s.x) * 180 / Math.PI;
      if (ang < 0) ang += 360;
      return ang;
    } else {
      return seg.sweepAngle;
    }
  }

  resetLocks(): void {
    this.lockLineLength = false;
    this.lockLineAngle = false;
    this.lockArcRadius = false;
    this.lockArcAngle = false;
    this.lockArcDirection = false;
  }

  onManualInput(field: string): void {
    if (field === 'lineLength') this.lockLineLength = true;
    if (field === 'lineAngle') this.lockLineAngle = true;
    if (field === 'arcRadius') this.lockArcRadius = true;
    if (field === 'arcAngle') this.lockArcAngle = true;
    this.draw();
  }

  setDirection(dir: 'left'|'right'): void {
    this.arcDirection = dir;
    this.lockArcDirection = true; 
    this.draw();
  }

  private draw(): void {
    if (!this.ctx || !this.canvasRef) return;
    const canvas = this.canvasRef.nativeElement;
    this.ctx.clearRect(0, 0, canvas.width, canvas.height);

    this.drawGrid();
    this.drawSegments();
    this.drawPoints();
    this.drawCurrentTangent();
    this.drawPreview();
    this.drawSnapIndicator();
    this.drawHUD();
  }

  private drawGrid(): void {
    const canvas = this.canvasRef.nativeElement;
    const gridSize = 50;
    const sw = this.screenToWorld(0, 0);
    const ew = this.screenToWorld(canvas.width, canvas.height);

    this.ctx.strokeStyle = '#1a2a3e';
    this.ctx.lineWidth = 1;
    const sx = Math.floor(sw.x / gridSize) * gridSize;
    const ex = Math.ceil(ew.x / gridSize) * gridSize;
    const sy = Math.floor(sw.y / gridSize) * gridSize;
    const ey = Math.ceil(ew.y / gridSize) * gridSize;

    this.ctx.beginPath();
    for (let x = sx; x <= ex; x += gridSize) {
      const p1 = this.worldToScreen(x, sw.y);
      const p2 = this.worldToScreen(x, ew.y);
      this.ctx.moveTo(p1.x, p1.y);
      this.ctx.lineTo(p2.x, p2.y);
    }
    for (let y = sy; y <= ey; y += gridSize) {
      const p1 = this.worldToScreen(sw.x, y);
      const p2 = this.worldToScreen(ew.x, y);
      this.ctx.moveTo(p1.x, p1.y);
      this.ctx.lineTo(p2.x, p2.y);
    }
    this.ctx.stroke();

    this.ctx.strokeStyle = '#3a5a8e';
    this.ctx.lineWidth = 1.5;
    const o = this.worldToScreen(0, 0);
    this.ctx.beginPath();
    this.ctx.moveTo(o.x, 0); this.ctx.lineTo(o.x, canvas.height);
    this.ctx.moveTo(0, o.y); this.ctx.lineTo(canvas.width, o.y);
    this.ctx.stroke();
  }

  private drawSegments(): void {
    for (const seg of this.segments) {
      const start = this.points.find(p => p.id === seg.startId);
      const end = this.points.find(p => p.id === seg.endId);
      if (!start || !end) continue;

      const isSelected = this.selectedSegment?.id === seg.id;
      this.ctx.strokeStyle = isSelected ? '#ffaa00' : '#ff4444';
      this.ctx.lineWidth = isSelected ? 4 : 2.5;

      if (seg.type === 'line') {
        const p1 = this.worldToScreen(start.x, start.y);
        const p2 = this.worldToScreen(end.x, end.y);
        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.lineTo(p2.x, p2.y);
        this.ctx.stroke();

        const len = Math.hypot(end.x - start.x, end.y - start.y);
        const ang = Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI;
        const mid = this.worldToScreen((start.x + end.x) / 2, (start.y + end.y) / 2);
        const text = `${len.toFixed(1)} мм / ${ang.toFixed(0)}°`;
        this.ctx.font = 'bold 11px monospace';
        const w = this.ctx.measureText(text).width + 10;
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        this.ctx.fillRect(mid.x - w / 2, mid.y - 18, w, 16);
        this.ctx.fillStyle = '#4caf50';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(text, mid.x, mid.y - 10);

      } else {
        const c = this.worldToScreen(seg.center.x, seg.center.y);
        const r = seg.radius * this.camera.zoom;

        // ВАЖНО: Рисуем дугу, инвертируя углы для Canvas (так как Y идет вниз)
        this.ctx.beginPath();
        this.ctx.arc(c.x, c.y, r, -seg.startAngle, -seg.endAngle, seg.ccw);
        this.ctx.stroke();

        const ps = this.worldToScreen(start.x, start.y);
        const pe = this.worldToScreen(end.x, end.y);
        this.ctx.strokeStyle = 'rgba(136, 136, 136, 0.4)';
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([3, 3]);
        this.ctx.beginPath();
        this.ctx.moveTo(ps.x, ps.y);
        this.ctx.lineTo(c.x, c.y);
        this.ctx.lineTo(pe.x, pe.y);
        this.ctx.stroke();
        this.ctx.setLineDash([]);

        this.ctx.fillStyle = isSelected ? '#ffaa00' : '#888';
        this.ctx.beginPath();
        this.ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.strokeStyle = '#fff';
        this.ctx.lineWidth = 1.5;
        this.ctx.stroke();

        const dir = seg.ccw ? 1 : -1;
        const sweepRad = seg.sweepAngle * Math.PI / 180;
        const midAng = seg.startAngle + dir * (sweepRad / 2);
          
        const lx = c.x + Math.cos(-midAng) * (r + 25);
        const ly = c.y + Math.sin(-midAng) * (r + 25);

        const angleDeg = Math.abs(seg.sweepAngle);
        this.ctx.fillStyle = '#ffaa00';
        this.ctx.font = 'bold 12px monospace';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(`R${seg.radius.toFixed(1)}`, lx, ly);
        this.ctx.font = '10px monospace';
        this.ctx.fillStyle = '#aaa';
        this.ctx.fillText(`${angleDeg.toFixed(1)}°`, lx, ly + 14);
      }
    }
  }

  private drawPoints(): void {
    for (const p of this.points) {
      const sp = this.worldToScreen(p.x, p.y);
      const isCurrent = this.currentPoint?.id === p.id;

      this.ctx.fillStyle = isCurrent ? '#4caf50' : '#4a90d9';
      this.ctx.beginPath();
      this.ctx.arc(sp.x, sp.y, isCurrent ? 6 : 4, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.strokeStyle = '#fff';
      this.ctx.lineWidth = 1.5;
      this.ctx.stroke();
    }
  }

  private drawCurrentTangent(): void {
    if (!this.currentPoint) return;

    const p = this.worldToScreen(this.currentPoint.x, this.currentPoint.y);
    const len = 40;
    const rad = this.currentTangent * Math.PI / 180;
    const ex = p.x + Math.cos(rad) * len;
    const ey = p.y - Math.sin(rad) * len; // Маппинг Y-flipped для Canvas

    this.ctx.strokeStyle = 'rgba(76, 175, 80, 0.6)';
    this.ctx.lineWidth = 1.5;
    this.ctx.setLineDash([4, 4]);
    this.ctx.beginPath();
    this.ctx.moveTo(p.x, p.y);
    this.ctx.lineTo(ex, ey);
    this.ctx.stroke();
    this.ctx.setLineDash([]);

    const arrowLen = 8;
    const arrowAng = Math.atan2(ey - p.y, ex - p.x);
    this.ctx.fillStyle = 'rgba(76, 175, 80, 0.8)';
    this.ctx.beginPath();
    this.ctx.moveTo(ex, ey);
    this.ctx.lineTo(
      ex - arrowLen * Math.cos(arrowAng - 0.4),
      ey - arrowLen * Math.sin(arrowAng - 0.4)
    );
    this.ctx.lineTo(
      ex - arrowLen * Math.cos(arrowAng + 0.4),
      ey - arrowLen * Math.sin(arrowAng + 0.4)
    );
    this.ctx.closePath();
    this.ctx.fill();
  }

  private drawPreview(): void {
    if (!this.currentPoint) return;

    const p = this.worldToScreen(this.currentPoint.x, this.currentPoint.y);

    if (this.tool === 'line') {
      const rad = this.lineAngle * Math.PI / 180;
      const endX = this.currentPoint.x + Math.cos(rad) * this.lineLength;
      const endY = this.currentPoint.y + Math.sin(rad) * this.lineLength;
      const pe = this.worldToScreen(endX, endY);

      this.ctx.strokeStyle = 'rgba(76, 175, 80, 0.7)';
      this.ctx.lineWidth = 2;
      this.ctx.setLineDash([6, 4]);
      this.ctx.beginPath();
      this.ctx.moveTo(p.x, p.y);
      this.ctx.lineTo(pe.x, pe.y);
      this.ctx.stroke();
      this.ctx.setLineDash([]);

      const midX = (p.x + pe.x) / 2;
      const midY = (p.y + pe.y) / 2;
      const text = `${this.lineLength} мм / ${this.lineAngle}°`;
      this.ctx.font = 'bold 12px monospace';
      const w = this.ctx.measureText(text).width + 10;
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      this.ctx.fillRect(midX - w / 2, midY - 20, w, 18);
      this.ctx.fillStyle = '#4caf50';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(text, midX, midY - 11);

    } else {
      const R = this.arcRadius;
      let turnAngleDeg = this.arcMode === 'angle' ? this.arcAngle : (this.arcArcLength / R) * (180 / Math.PI);
      const turnRad = turnAngleDeg * Math.PI / 180;
      const tangentRad = this.currentTangent * Math.PI / 180;
      
      const dir = this.arcDirection === 'left' ? 1 : -1;
      
      const normalRad = tangentRad + dir * (Math.PI / 2);
      const centerX = this.currentPoint.x + R * Math.cos(normalRad);
      const centerY = this.currentPoint.y + R * Math.sin(normalRad);
      
      const startAngle = normalRad + Math.PI;
      const endAngle = startAngle + dir * turnRad;

      const c = this.worldToScreen(centerX, centerY);
      const r = R * this.camera.zoom;

      const p1 = this.worldToScreen(this.currentPoint.x, this.currentPoint.y);
      const endX = centerX + R * Math.cos(endAngle);
      const endY = centerY + R * Math.sin(endAngle);
      const p2 = this.worldToScreen(endX, endY);
      
      this.ctx.strokeStyle = 'rgba(255, 170, 0, 0.3)';
      this.ctx.lineWidth = 1;
      this.ctx.setLineDash([4, 4]);
      this.ctx.beginPath();
      this.ctx.moveTo(p1.x, p1.y);
      this.ctx.lineTo(p2.x, p2.y);
      this.ctx.stroke();
      this.ctx.setLineDash([]);

      this.ctx.strokeStyle = 'rgba(255, 170, 0, 0.8)';
      this.ctx.lineWidth = 2.5;
      this.ctx.setLineDash([6, 4]);
      
      // ВАЖНЫЙ МАППИНГ: Инвертируем углы для Canvas (так как Y в Canvas идет вниз)
      this.ctx.beginPath();
      this.ctx.arc(c.x, c.y, r, -startAngle, -endAngle, this.arcDirection === 'left');
      this.ctx.stroke();
      this.ctx.setLineDash([]);

      this.ctx.strokeStyle = 'rgba(255, 170, 0, 0.3)';
      this.ctx.lineWidth = 1;
      this.ctx.setLineDash([3, 3]);
      this.ctx.beginPath();
      this.ctx.moveTo(p1.x, p1.y);
      this.ctx.lineTo(c.x, c.y);
      this.ctx.lineTo(p2.x, p2.y);
      this.ctx.stroke();
      this.ctx.setLineDash([]);

      this.ctx.fillStyle = 'rgba(255, 170, 0, 0.8)';
      this.ctx.beginPath();
      this.ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
      this.ctx.fill();

      const midAng = startAngle + dir * (turnRad / 2);
        
      const lx = c.x + Math.cos(-midAng) * (r + 25);
      const ly = c.y + Math.sin(-midAng) * (r + 25);

      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
      this.ctx.fillRect(lx - 55, ly - 18, 110, 32);
      this.ctx.fillStyle = '#ffaa00';
      this.ctx.font = 'bold 11px monospace';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(`R${R} | ${turnAngleDeg.toFixed(1)}°`, lx, ly - 6);
      this.ctx.fillStyle = '#aaa';
      this.ctx.font = '10px monospace';
      this.ctx.fillText(this.arcDirection === 'left' ? '↺ Влево' : '↻ Вправо', lx, ly + 8);
    }
  }

  private drawSnapIndicator(): void {
    if (!this.currentSnap) return;
    const sp = this.worldToScreen(this.currentSnap.point.x, this.currentSnap.point.y);
    const s = 8;
    this.ctx.lineWidth = 2;

    if (this.currentSnap.kind === 'endpoint') {
      this.ctx.strokeStyle = '#4caf50';
      this.ctx.strokeRect(sp.x - s, sp.y - s, s * 2, s * 2);
    } else if (this.currentSnap.kind === 'midpoint') {
      this.ctx.strokeStyle = '#ff9800';
      this.ctx.beginPath();
      this.ctx.moveTo(sp.x, sp.y - s);
      this.ctx.lineTo(sp.x + s, sp.y + s);
      this.ctx.lineTo(sp.x - s, sp.y + s);
      this.ctx.closePath();
      this.ctx.stroke();
    }
  }

  private drawHUD(): void {
    const canvas = this.canvasRef.nativeElement;

    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    this.ctx.fillRect(10, 10, 220, 50);
    this.ctx.fillStyle = '#4a90d9';
    this.ctx.font = '12px monospace';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';
    this.ctx.fillText(`X: ${this.snappedCursor.x.toFixed(1)}  Y: ${this.snappedCursor.y.toFixed(1)}`, 15, 15);

    if (this.currentPoint) {
      this.ctx.fillStyle = '#4caf50';
      this.ctx.fillText(`Точка: (${this.currentPoint.x.toFixed(0)}, ${this.currentPoint.y.toFixed(0)})`, 15, 30);
      this.ctx.fillText(`Касат.: ${this.currentTangent.toFixed(0)}°`, 15, 45);
    } else {
      this.ctx.fillStyle = '#ffaa00';
      this.ctx.fillText('Клик — задать начальную точку', 15, 30);
    }

    if (this.orthoMode) {
      this.ctx.fillStyle = 'rgba(76, 175, 80, 0.8)';
      this.ctx.fillRect(canvas.width - 70, 10, 60, 22);
      this.ctx.fillStyle = 'white';
      this.ctx.font = 'bold 12px monospace';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('ORTHO', canvas.width - 40, 24);
    }
  }

  setTool(t: 'line' | 'arc'): void {
    this.tool = t;
    this.resetLocks(); 
    this.draw();
  }

  setStartPointHere(): void {
    this.pushHistory();
    this.currentPoint = this.findOrCreatePoint(this.snappedCursor);
    this.currentTangent = 0;
    this.draw();
  }

  resetTangent(): void {
    this.currentTangent = 0;
    this.draw();
  }

  clearAll(): void {
    if (!confirm('Очистить всё?')) return;
    this.pushHistory();
    this.points = [];
    this.segments = [];
    this.currentPoint = null;
    this.currentTangent = 0;
    this.selectedSegment = null;
    this.nextId = 1;
    this.resetLocks();
    this.draw();
  }

  resetView(): void {
    if (this.points.length === 0) {
      const c = this.canvasRef.nativeElement;
      this.camera = { x: c.width / 2, y: c.height / 2, zoom: 2 };
    } else {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of this.points) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
      const c = this.canvasRef.nativeElement;
      this.camera.x = c.width / 2 - ((minX + maxX) / 2) * this.camera.zoom;
      this.camera.y = c.height / 2 + ((minY + maxY) / 2) * this.camera.zoom;
    }
    this.draw();
  }

  onSave(): void {
    const result: PathSegment[] = [];
    for (const seg of this.segments) {
      if (seg.type === 'line') {
        result.push({
          id: seg.id, type: 'line',
          value: Math.round(this.getSegmentLength(seg) * 100) / 100,
          angle: 0, direction: 'left'
        });
      } else {
        const ang = this.getSegmentAngle(seg);
        result.push({
          id: seg.id, type: 'arc',
          value: Math.round(seg.radius * 100) / 100,
          angle: Math.round(ang * 100) / 100,
          direction: seg.ccw ? 'left' : 'right'
        });
      }
    }
    this.save.emit(result);
  }

  onCancel(): void {
    this.cancel.emit();
  }

  private reconstructFromSegments(segments: PathSegment[]): void {
    if (segments.length === 0) return;
    let curX = 0, curY = 0, curAng = 0;
    const p0: Point = { id: this.nextId++, x: 0, y: 0 };
    this.points.push(p0);
    let last = p0;

    for (const seg of segments) {
      let end: Point;
      if (seg.type === 'line') {
        const rad = curAng * Math.PI / 180;
        end = {
          id: this.nextId++,
          x: curX + Math.cos(rad) * seg.value,
          y: curY + Math.sin(rad) * seg.value 
        };
        this.points.push(end);
        this.segments.push({ id: this.nextId++, type: 'line', startId: last.id, endId: end.id });
        curX = end.x; curY = end.y;
        curAng = curAng; 
      } else {
        const R = seg.value; 
        const turnAngleDeg = seg.angle; 
        const turnRad = turnAngleDeg * Math.PI / 180;
        const arcLen = R * turnRad;
        
        const ccw = seg.direction === 'left';
        const dir = ccw ? 1 : -1; 
        const tangentRad = curAng * Math.PI / 180;

        const normalRad = tangentRad + dir * (Math.PI / 2);
        const centerX = curX + R * Math.cos(normalRad);
        const centerY = curY + R * Math.sin(normalRad);

        const startAngle = normalRad + Math.PI;
        const endAngle = startAngle + dir * turnRad;

        const endX = centerX + R * Math.cos(endAngle);
        const endY = centerY + R * Math.sin(endAngle);
        
        end = { id: this.nextId++, x: endX, y: endY };
        this.points.push(end);
        
        this.segments.push({
          id: this.nextId++, 
          type: 'arc',
          startId: last.id, 
          endId: end.id,
          center: { x: centerX, y: centerY }, 
          radius: R,
          startAngle, 
          endAngle,
          sweepAngle: turnAngleDeg,  
          arcLength: arcLen,         
          ccw
        });
        
        curX = endX; curY = endY;
        curAng = curAng + dir * turnAngleDeg;
        while (curAng < 0) curAng += 360;
        while (curAng >= 360) curAng -= 360;
      }
      last = end;
    }
  }

  get totalPathLength(): number {
    let t = 0;
    for (const seg of this.segments) {
      if (seg.type === 'line') {
        const s = this.points.find(p => p.id === seg.startId)!;
        const e = this.points.find(p => p.id === seg.endId)!;
        t += Math.hypot(e.x - s.x, e.y - s.y);
      } else {
        t += seg.arcLength;
      }
    }
    return t;
  }

  get commandPrompt(): string {
    if (!this.currentPoint) {
      return `Кликните на холст, чтобы задать начальную точку траектории`;
    }
    if (this.tool === 'line') {
      return `ЛИНИЯ: Задайте размеры или кликните. (Enter - создать)`;
    } else {
      return `ДУГА: Настройте Радиус/Угол (🔓/🔒) или кликните.`;
    }
  }
}