import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { HomeAssistant } from "./ha-types";
import { runAction } from "./actions";
import { possibleBindingKeys, summarizeModel } from "./model-index";
import type { CameraView, IndexedModel, ThreeDHomeCardConfig } from "./types";

@customElement("threed-home-card")
export class ThreeDHomeCard extends LitElement {
  @property({ attribute: false }) hass?: HomeAssistant;

  @state() private config?: ThreeDHomeCardConfig;
  @state() private modelSummary: IndexedModel = { lights: [], rooms: [], all: [] };
  @state() private editMode = false;
  @state() private selectedName = "";
  @state() private draftConfig = "";
  @state() private loadError = "";

  private container?: HTMLDivElement;
  private renderer?: WebGLRenderer;
  private scene?: Scene;
  private camera?: OrthographicCamera;
  private controls?: OrbitControls;
  private modelRoot?: import("three").Object3D;
  private raycaster = new Raycaster();
  private pointer = new Vector2();
  private resizeObserver?: ResizeObserver;
  private animationFrame = 0;
  private renderRequested = false;
  private activeView?: number;

  static getConfigElement(): HTMLElement {
    return document.createElement("threed-home-card-editor");
  }

  static getStubConfig(): Partial<ThreeDHomeCardConfig> {
    return {
      model_url: "/local/floorplans/home.glb",
      view_entity: "number.3d_home_view",
      performance: defaultPerformance(),
      lights: {},
      rooms: {},
      views: []
    };
  }

  setConfig(config: ThreeDHomeCardConfig): void {
    if (!config.model_url) {
      throw new Error("model_url is required");
    }
    this.config = {
      lights: {},
      rooms: {},
      views: [],
      view_entity: "number.3d_home_view",
      performance: defaultPerformance(),
      ...config
    };
    this.draftConfig = JSON.stringify(this.config, null, 2);
    void this.loadModel();
  }

  connectedCallback(): void {
    super.connectedCallback();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    this.renderer?.dispose();
  }

  protected firstUpdated(): void {
    this.container = this.renderRoot.querySelector(".viewport") as HTMLDivElement | undefined;
    this.initializeRenderer();
    void this.loadModel();
  }

  protected updated(): void {
    this.updateFromHass();
    this.requestSceneRender();
  }

  protected render() {
    return html`
      <ha-card>
        <div class="shell">
          <div class="toolbar">
            <button @click=${this.fitTopDown}>Top</button>
            <button @click=${() => this.adjustZoom(1.15)}>+</button>
            <button @click=${() => this.adjustZoom(0.85)}>-</button>
            <button @click=${this.saveCurrentView}>Save view</button>
            <button class=${this.editMode ? "active" : ""} @click=${() => (this.editMode = !this.editMode)}>Edit</button>
          </div>
          <div class="body">
            <div class="viewport" @click=${this.onViewportClick}></div>
            ${this.editMode ? this.renderSetupPanel() : nothing}
            ${this.loadError ? html`<div class="error">${this.loadError}</div>` : nothing}
          </div>
        </div>
      </ha-card>
    `;
  }

  private renderSetupPanel() {
    return html`
      <aside class="setup">
        <h3>Setup</h3>
        <label>
          Selected group
          <select .value=${this.selectedName} @change=${this.onSelectedChange}>
            <option value="">Select from model</option>
            <optgroup label="Lights">
              ${this.modelSummary.lights.map((name) => html`<option value=${name}>${name}</option>`)}
            </optgroup>
            <optgroup label="Rooms">
              ${this.modelSummary.rooms.map((name) => html`<option value=${name}>${name}</option>`)}
            </optgroup>
          </select>
        </label>
        <label>
          Entity id
          <input id="entityInput" placeholder="light.kitchen_table" />
        </label>
        <button @click=${this.bindSelectedLight}>Assign as light</button>
        <button @click=${this.bindSelectedRoomToggle}>Assign room toggle</button>
        <label>
          Card config
          <textarea .value=${this.draftConfig} @input=${this.onDraftInput}></textarea>
        </label>
        <button @click=${this.applyDraftConfig}>Apply draft</button>
      </aside>
    `;
  }

  private initializeRenderer(): void {
    if (!this.container || this.renderer) {
      return;
    }
    this.scene = new Scene();
    this.scene.background = new Color(0x151719);

    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 10000);
    this.camera.position.set(0, 50, 0);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);

    const performance = this.config?.performance ?? defaultPerformance();
    this.renderer = new WebGLRenderer({
      antialias: performance.antialias ?? false,
      alpha: false,
      powerPreference: "high-performance"
    });
    this.renderer.shadowMap.enabled = performance.shadows ?? false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, performance.max_pixel_ratio ?? 1.5));
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = performance.smooth_camera ?? false;
    this.controls.screenSpacePanning = true;
    this.controls.target.set(0, 0, 0);
    this.controls.addEventListener("change", () => this.requestSceneRender());

    this.scene.add(new AmbientLight(0xffffff, 1.6));
    const sun = new DirectionalLight(0xffffff, 1.2);
    sun.position.set(10, 30, 20);
    this.scene.add(sun);

    this.resizeObserver = new ResizeObserver(() => this.resizeRenderer());
    this.resizeObserver.observe(this.container);
    this.resizeRenderer();
    this.requestSceneRender();
  }

  private async loadModel(): Promise<void> {
    if (!this.config || !this.scene) {
      return;
    }
    this.loadError = "";
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(this.config.model_url);
      if (this.modelRoot) {
        this.scene.remove(this.modelRoot);
      }
      this.modelRoot = gltf.scene;
      this.scene.add(this.modelRoot);
      this.modelSummary = summarizeModel(this.modelRoot);
      this.fitTopDown();
      this.updateFromHass();
      this.requestSceneRender();
    } catch (error) {
      this.loadError = error instanceof Error ? error.message : String(error);
    }
  }

  private updateFromHass(): void {
    if (!this.hass || !this.config || !this.modelRoot) {
      return;
    }
    this.updateViewEntity();
    this.updateLightVisibility();
    this.updateLightBindings();
  }

  private updateViewEntity(): void {
    const entityId = this.config?.view_entity;
    if (!entityId) {
      return;
    }
    const state = this.hass?.states[entityId]?.state;
    const viewNumber = Number.parseInt(String(state), 10);
    if (!Number.isFinite(viewNumber) || viewNumber === this.activeView) {
      return;
    }
    this.applyView(viewNumber);
  }

  private updateLightBindings(): void {
    if (!this.modelRoot) {
      return;
    }
    this.modelRoot.traverse((object) => {
      if (!isLightRoot(object)) {
        return;
      }
      const entityId = this.resolveLightEntity(object);
      if (!entityId) {
        return;
      }
      const state = this.hass?.states[entityId];
      const isOn = state?.state === "on";
      const brightness = typeof state?.attributes.brightness === "number" ? Number(state.attributes.brightness) / 255 : 1;
      const color = Array.isArray(state?.attributes.rgb_color)
        ? new Color(`rgb(${state.attributes.rgb_color.join(",")})`)
        : new Color(0xfff2cf);

      object.traverse((child) => {
        if (!(child instanceof Mesh)) {
          return;
        }
        const material = cloneStandardMaterial(child);
        material.emissive = color;
        material.emissiveIntensity = isOn ? Math.max(0.35, brightness * 1.8) : 0;
        child.material = material;
      });
    });
    this.requestSceneRender();
  }

  private resolveLightEntity(object: import("three").Object3D): string | undefined {
    const explicit = findBinding(this.config?.lights, object.name)?.entity;
    if (explicit) {
      return explicit;
    }
    const hinted = stringExtra(object, "haEntity");
    if (hinted) {
      return hinted;
    }
    return inferredLightEntity(object.name);
  }

  private updateLightVisibility(): void {
    if (!this.modelRoot) {
      return;
    }
    const hideCeilingLightGeometry = this.config?.performance?.hide_ceiling_light_geometry ?? false;
    this.modelRoot.traverse((object) => {
      if (!isLightRoot(object)) {
        return;
      }
      if (isCeilingLightObject(object)) {
        object.visible = !hideCeilingLightGeometry;
      } else {
        object.visible = true;
      }
    });
    this.requestSceneRender();
  }

  private fitTopDown = (): void => {
    if (!this.modelRoot || !this.camera || !this.controls || !this.container) {
      return;
    }
    const box = new Box3().setFromObject(this.modelRoot);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const maxSize = Math.max(size.x, size.z, 1);
    this.camera.position.set(center.x, center.y + maxSize * 1.35, center.z);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(center);
    this.camera.zoom = 1;
    this.controls.target.copy(center);
    this.resizeRenderer();
    this.controls.update();
    this.requestSceneRender();
  };

  private saveCurrentView = (): void => {
    if (!this.config || !this.camera || !this.controls) {
      return;
    }
    const view: CameraView = {
      name: `View ${(this.config.views?.length ?? 0) + 1}`,
      position: vectorToTuple(this.camera.position),
      target: vectorToTuple(this.controls.target),
      zoom: this.camera.zoom
    };
    const nextConfig = {
      ...this.config,
      views: [...(this.config.views ?? []), view]
    };
    this.config = nextConfig;
    this.draftConfig = JSON.stringify(nextConfig, null, 2);
    this.dispatchConfigChanged(nextConfig);
  };

  private applyView(viewNumber: number): void {
    const view = this.config?.views?.[viewNumber - 1];
    if (!view || !this.camera || !this.controls) {
      return;
    }
    this.activeView = viewNumber;
    this.camera.position.set(...view.position);
    this.camera.zoom = view.zoom;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(...view.target);
    this.controls.update();
    this.requestSceneRender();
  }

  private adjustZoom(factor: number): void {
    if (!this.camera) {
      return;
    }
    this.camera.zoom = Math.min(20, Math.max(0.1, this.camera.zoom * factor));
    this.camera.updateProjectionMatrix();
    this.requestSceneRender();
  }

  private async onViewportClick(event: MouseEvent): Promise<void> {
    if (!this.container || !this.camera || !this.modelRoot || !this.config) {
      return;
    }
    const rect = this.container.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.modelRoot, true)[0];
    const named = hit ? nearestNamedObject(hit.object) : undefined;
    if (!named?.name) {
      return;
    }
    this.selectedName = named.name;
    if (this.editMode) {
      return;
    }
    const roomBinding = findBinding(this.config.rooms, named.name);
    const action = roomBinding?.tap_action ?? hintedRoomAction(named);
    await runAction(this.hass, action);
  }

  private bindSelectedLight(): void {
    this.updateSelectedBinding("lights");
  }

  private bindSelectedRoomToggle(): void {
    const entity = this.entityInputValue();
    if (!this.config || !this.selectedName || !entity) {
      return;
    }
    const nextConfig: ThreeDHomeCardConfig = {
      ...this.config,
      rooms: {
        ...(this.config.rooms ?? {}),
        [this.selectedName]: {
          tap_action: {
            action: "toggle",
            entity
          }
        }
      }
    };
    this.config = nextConfig;
    this.draftConfig = JSON.stringify(nextConfig, null, 2);
    this.dispatchConfigChanged(nextConfig);
  }

  private updateSelectedBinding(kind: "lights"): void {
    const entity = this.entityInputValue();
    if (!this.config || !this.selectedName || !entity) {
      return;
    }
    const nextConfig: ThreeDHomeCardConfig = {
      ...this.config,
      [kind]: {
        ...(this.config[kind] ?? {}),
        [this.selectedName]: { entity }
      }
    };
    this.config = nextConfig;
    this.draftConfig = JSON.stringify(nextConfig, null, 2);
    this.updateFromHass();
    this.dispatchConfigChanged(nextConfig);
  }

  private entityInputValue(): string {
    return (this.renderRoot.querySelector("#entityInput") as HTMLInputElement | null)?.value.trim() ?? "";
  }

  private onSelectedChange(event: Event): void {
    this.selectedName = (event.target as HTMLSelectElement).value;
  }

  private onDraftInput(event: Event): void {
    this.draftConfig = (event.target as HTMLTextAreaElement).value;
  }

  private applyDraftConfig(): void {
    const parsed = JSON.parse(this.draftConfig) as ThreeDHomeCardConfig;
    this.setConfig(parsed);
  }

  private resizeRenderer(): void {
    if (!this.container || !this.renderer || !this.camera) {
      return;
    }
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    const frustum = 18;
    this.camera.left = (-frustum * aspect) / 2;
    this.camera.right = (frustum * aspect) / 2;
    this.camera.top = frustum / 2;
    this.camera.bottom = -frustum / 2;
    this.camera.updateProjectionMatrix();
    this.requestSceneRender();
  }

  private requestSceneRender(): void {
    if (this.renderRequested) {
      return;
    }
    this.renderRequested = true;
    this.animationFrame = requestAnimationFrame(() => {
      this.renderRequested = false;
      this.controls?.update();
      if (this.renderer && this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
      }
      if (this.config?.performance?.continuous_render) {
        this.requestSceneRender();
      }
    });
  }

  private dispatchConfigChanged(config: ThreeDHomeCardConfig): void {
    this.dispatchEvent(new CustomEvent("config-changed", {
      bubbles: true,
      composed: true,
      detail: { config }
    }));
  }

  static styles = css`
    :host {
      display: block;
    }

    ha-card {
      overflow: hidden;
    }

    .shell {
      position: relative;
      min-height: 520px;
      background: #151719;
      color: #f5f7fa;
    }

    .toolbar {
      position: absolute;
      z-index: 2;
      top: 10px;
      left: 10px;
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    button {
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 6px;
      background: rgba(20, 24, 28, 0.84);
      color: #fff;
      padding: 7px 10px;
      cursor: pointer;
    }

    button.active {
      background: #1f6feb;
    }

    .body,
    .viewport {
      position: absolute;
      inset: 0;
    }

    .viewport canvas {
      display: block;
      width: 100%;
      height: 100%;
    }

    .setup {
      position: absolute;
      z-index: 2;
      top: 54px;
      right: 12px;
      bottom: 12px;
      width: min(360px, calc(100% - 24px));
      overflow: auto;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 8px;
      background: rgba(18, 22, 26, 0.94);
      padding: 14px;
      box-sizing: border-box;
    }

    .setup h3 {
      margin: 0 0 12px;
      font-size: 16px;
    }

    label {
      display: grid;
      gap: 6px;
      margin: 0 0 12px;
      font-size: 12px;
      color: #b7c0cc;
    }

    input,
    select,
    textarea {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 6px;
      background: #0d1117;
      color: #f5f7fa;
      padding: 8px;
      font: inherit;
    }

    textarea {
      min-height: 180px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
    }

    .error {
      position: absolute;
      left: 12px;
      right: 12px;
      bottom: 12px;
      z-index: 3;
      padding: 10px 12px;
      border-radius: 6px;
      background: #5f1b1b;
      color: #fff;
    }
  `;
}

@customElement("threed-home-card-editor")
export class ThreeDHomeCardEditor extends LitElement {
  @property({ attribute: false }) hass?: HomeAssistant;
  @state() private config: Partial<ThreeDHomeCardConfig> = {};

  setConfig(config: Partial<ThreeDHomeCardConfig>): void {
    this.config = config;
  }

  protected render() {
    return html`
      <div class="editor">
        <label>
          Model URL
          <input .value=${this.config.model_url ?? ""} @input=${(event: Event) => this.updateField("model_url", event)} />
        </label>
        <label>
          Camera view entity
          <input .value=${this.config.view_entity ?? "number.3d_home_view"} @input=${(event: Event) => this.updateField("view_entity", event)} />
        </label>
        <label>
          Max pixel ratio
          <input
            type="number"
            min="1"
            max="2"
            step="0.25"
            .value=${String(this.config.performance?.max_pixel_ratio ?? 1.5)}
            @input=${(event: Event) => this.updatePerformanceNumber("max_pixel_ratio", event)}
          />
        </label>
        <label class="row">
          <input
            type="checkbox"
            .checked=${this.config.performance?.antialias ?? false}
            @change=${(event: Event) => this.updatePerformanceBoolean("antialias", event)}
          />
          Antialiasing
        </label>
        <label class="row">
          <input
            type="checkbox"
            .checked=${this.config.performance?.smooth_camera ?? false}
            @change=${(event: Event) => this.updatePerformanceBoolean("smooth_camera", event)}
          />
          Smooth camera damping
        </label>
        <label class="row">
          <input
            type="checkbox"
            .checked=${this.config.performance?.continuous_render ?? false}
            @change=${(event: Event) => this.updatePerformanceBoolean("continuous_render", event)}
          />
          Continuous render
        </label>
        <label class="row">
          <input
            type="checkbox"
            .checked=${this.config.performance?.hide_ceiling_light_geometry ?? false}
            @change=${(event: Event) => this.updatePerformanceBoolean("hide_ceiling_light_geometry", event)}
          />
          Hide ceiling light geometry
        </label>
        <label class="row">
          <input
            type="checkbox"
            .checked=${this.config.performance?.shadows ?? false}
            @change=${(event: Event) => this.updatePerformanceBoolean("shadows", event)}
          />
          Shadows
        </label>
      </div>
    `;
  }

  private updateField(field: "model_url" | "view_entity", event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.config = { ...this.config, [field]: value };
    this.dispatchEvent(new CustomEvent("config-changed", {
      bubbles: true,
      composed: true,
      detail: { config: this.config }
    }));
  }

  private updatePerformanceBoolean(field: "antialias" | "continuous_render" | "hide_ceiling_light_geometry" | "shadows" | "smooth_camera", event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.updateConfig({
      performance: {
        ...(this.config.performance ?? defaultPerformance()),
        [field]: checked
      }
    });
  }

  private updatePerformanceNumber(field: "max_pixel_ratio", event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.updateConfig({
      performance: {
        ...(this.config.performance ?? defaultPerformance()),
        [field]: Number.isFinite(value) ? value : 1.5
      }
    });
  }

  private updateConfig(partial: Partial<ThreeDHomeCardConfig>): void {
    this.config = { ...this.config, ...partial };
    this.dispatchEvent(new CustomEvent("config-changed", {
      bubbles: true,
      composed: true,
      detail: { config: this.config }
    }));
  }

  static styles = css`
    .editor {
      display: grid;
      gap: 12px;
    }

    label {
      display: grid;
      gap: 6px;
    }

    input {
      width: 100%;
      box-sizing: border-box;
    }

    .row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .row input {
      width: auto;
    }
  `;
}

function cloneStandardMaterial(mesh: Mesh): MeshStandardMaterial {
  const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (source instanceof MeshStandardMaterial) {
    return source.clone();
  }
  return new MeshStandardMaterial({ color: 0xffffff });
}

function nearestNamedObject(object: import("three").Object3D): import("three").Object3D | undefined {
  let current: import("three").Object3D | null = object;
  while (current) {
    if (current.name && /^(room|light)_/.test(current.name)) {
      return current;
    }
    current = current.parent;
  }
  return object.name ? object : undefined;
}

function isLightRoot(object: import("three").Object3D): boolean {
  return String(object.userData?.type ?? "") === "light" || object.name.startsWith("light_");
}

function isCeilingLightObject(object: import("three").Object3D): boolean {
  const lightCategory = String(object.userData?.lightCategory ?? "").toLowerCase();
  const ceilingLight = String(object.userData?.ceilingLight ?? "").toLowerCase();
  return lightCategory === "ceilinglight"
      || ceilingLight === "true"
      || object.name.startsWith("light_ceilinglight_")
      || object.name.startsWith("light_ceiling_light_");
}

function stringExtra(object: import("three").Object3D, key: string): string | undefined {
  const value = object.userData?.[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function inferredLightEntity(name: string): string | undefined {
  const normalized = normalizeLightKey(name);
  return normalized ? "light." + normalized : undefined;
}

function normalizeLightKey(name: string): string | undefined {
  const normalized = name.trim().replace(/\s+/g, "_");
  if (!normalized.startsWith("light_")) {
    return undefined;
  }
  const key = normalized.slice("light_".length);
  return key.length > 0 ? key.toLowerCase() : undefined;
}

function hintedRoomAction(object: import("three").Object3D) {
  const action = stringExtra(object, "haTapAction");
  const entity = stringExtra(object, "haEntity");
  const service = stringExtra(object, "haService");
  const targetEntity = stringExtra(object, "haTargetEntity");

  if (service) {
    return {
      action: "call-service" as const,
      service,
      target: targetEntity ? { entity_id: targetEntity } : entity ? { entity_id: entity } : undefined
    };
  }
  if (action === "none") {
    return { action: "none" as const };
  }
  if (entity) {
    return {
      action: "toggle" as const,
      entity
    };
  }
  return undefined;
}

function findBinding<T>(bindings: Record<string, T> | undefined, name: string): T | undefined {
  if (!bindings) {
    return undefined;
  }
  for (const key of possibleBindingKeys(name)) {
    if (bindings[key]) {
      return bindings[key];
    }
  }
  return undefined;
}

function vectorToTuple(vector: Vector3): [number, number, number] {
  return [round(vector.x), round(vector.y), round(vector.z)];
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function defaultPerformance() {
  return {
    antialias: false,
    continuous_render: false,
    hide_ceiling_light_geometry: false,
    max_pixel_ratio: 1.5,
    shadows: false,
    smooth_camera: false
  };
}

declare global {
  interface Window {
    customCards?: Array<Record<string, unknown>>;
  }
}

window.customCards = window.customCards ?? [];
window.customCards.push({
  type: "threed-home-card",
  name: "3D Home Card",
  preview: false,
  description: "Interactive 3D floorplan card for Sweet Home 3D GLB exports."
});
