import type { LovelaceActionConfig } from "./ha-types";

export interface EntityBinding {
  entity: string;
}

export interface RoomBinding {
  entity?: string;
  tap_action?: LovelaceActionConfig;
}

export interface CameraView {
  name?: string;
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
}

export interface PerformanceOptions {
  antialias?: boolean;
  continuous_render?: boolean;
  hide_ceiling_light_geometry?: boolean;
  max_pixel_ratio?: number;
  shadows?: boolean;
  smooth_camera?: boolean;
}

export interface ThreeDHomeCardConfig {
  type: string;
  model_url: string;
  view_entity?: string;
  default_view?: number;
  performance?: PerformanceOptions;
  lights?: Record<string, EntityBinding>;
  rooms?: Record<string, RoomBinding>;
  views?: CameraView[];
}

export interface IndexedModel {
  lights: string[];
  rooms: string[];
  all: string[];
}
