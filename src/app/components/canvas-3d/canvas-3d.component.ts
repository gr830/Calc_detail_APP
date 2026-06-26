import { 
  Component, OnInit, OnDestroy, ElementRef, ViewChild, 
  Input, OnChanges 
} from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'; // ← Исправлено
import { CalculationResult } from '../../models/calculation.model';

@Component({
  selector: 'app-canvas-3d',
  standalone: true,
  templateUrl: './canvas-3d.component.html',
  styleUrls: ['./canvas-3d.component.css']
})
export class Canvas3dComponent implements OnInit, OnDestroy, OnChanges {
  @ViewChild('canvas3d', { static: true }) canvasRef!: ElementRef;
  
  @Input() width: number = 17;
  @Input() length: number = 24;
  @Input() cutterDiameter: number = 8;
  @Input() result: CalculationResult | null = null;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;
  private animationId: number = 0;
  
  private workpiece!: THREE.Mesh;
  private toolpaths: THREE.Line[] = [];
  private cutter!: THREE.Mesh;

  ngOnInit(): void {
    this.initScene();
    this.animate();
    window.addEventListener('resize', this.onResize.bind(this));
  }

  ngOnChanges(): void {
    if (this.scene) this.updateVisualization();
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this.onResize.bind(this));
    this.renderer?.dispose();
  }

  private initScene(): void {
    const canvas = this.canvasRef.nativeElement;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    this.camera = new THREE.PerspectiveCamera(
      60, canvas.clientWidth / canvas.clientHeight, 0.1, 1000
    );
    this.camera.position.set(30, 25, 30);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.shadowMap.enabled = true;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(20, 30, 20);
    this.scene.add(dirLight);
    this.scene.add(new THREE.GridHelper(100, 50, 0x444444, 0x222222));

    this.updateVisualization();
  }

  private updateVisualization(): void {
    if (this.workpiece) this.scene.remove(this.workpiece);
    this.toolpaths.forEach(t => this.scene.remove(t));
    this.toolpaths = [];
    if (this.cutter) this.scene.remove(this.cutter);

    const depth = 2;
    const geometry = new THREE.BoxGeometry(this.length, depth, this.width);
    const material = new THREE.MeshPhongMaterial({ 
      color: 0x4a90d9, transparent: true, opacity: 0.8 
    });
    this.workpiece = new THREE.Mesh(geometry, material);
    this.workpiece.position.y = depth / 2;
    this.scene.add(this.workpiece);

    if (this.result) {
      const stepOver = this.result.stepOver;
      const passes = this.result.passesAcross;
      const topY = depth + 0.1;
      
      for (let i = 0; i < passes; i++) {
        const zPos = -this.width / 2 + stepOver / 2 + i * stepOver;
        const points = [];
        
        if (i % 2 === 0) {
          points.push(new THREE.Vector3(-this.length / 2, topY, zPos));
          points.push(new THREE.Vector3(this.length / 2, topY, zPos));
        } else {
          points.push(new THREE.Vector3(this.length / 2, topY, zPos));
          points.push(new THREE.Vector3(-this.length / 2, topY, zPos));
        }

        const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(lineGeometry, new THREE.LineBasicMaterial({ color: 0xff4444 }));
        this.toolpaths.push(line);
        this.scene.add(line);
      }

      const cutterGeometry = new THREE.CylinderGeometry(
        this.cutterDiameter / 2, this.cutterDiameter / 2, depth + 1, 16
      );
      this.cutter = new THREE.Mesh(cutterGeometry, new THREE.MeshPhongMaterial({ color: 0xffaa00 }));
      this.cutter.position.set(-this.length / 2, (depth + 1) / 2, -this.width / 2 + stepOver / 2);
      this.scene.add(this.cutter);
    }

    this.controls.target.set(0, depth / 2, 0);
    this.controls.update();
  }

  private animate(): void {
    this.animationId = requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private onResize(): void {
    const canvas = this.canvasRef.nativeElement;
    const parent = canvas.parentElement;
    if (parent) {
      this.camera.aspect = parent.clientWidth / parent.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(parent.clientWidth, parent.clientHeight);
    }
  }
}