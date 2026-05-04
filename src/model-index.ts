import type { Object3D } from "three";
import type { IndexedModel } from "./types";

export function createNodeIndex(root: Object3D): Map<string, Object3D[]> {
  const index = new Map<string, Object3D[]>();
  root.traverse((object) => {
    if (!object.name) {
      return;
    }
    const names = [object.name, normalizeModelName(object.name)];
    for (const name of names) {
      const list = index.get(name) ?? [];
      if (!list.includes(object)) {
        list.push(object);
      }
      index.set(name, list);
    }
  });
  return index;
}

export function summarizeModel(root: Object3D): IndexedModel {
  const lights = new Set<string>();
  const rooms = new Set<string>();
  const all = new Set<string>();

  root.traverse((object) => {
    if (!object.name) {
      return;
    }
    all.add(object.name);
    const type = String(object.userData?.type ?? "");
    if (type === "light" || object.name.startsWith("light_")) {
      lights.add(object.name);
    }
    if (type === "room" || object.name.startsWith("room_")) {
      rooms.add(object.name);
    }
  });

  return {
    lights: [...lights].sort(),
    rooms: [...rooms].sort(),
    all: [...all].sort()
  };
}

export function normalizeModelName(name: string): string {
  return name.trim().replace(/\s+/g, "_");
}

export function possibleBindingKeys(name: string): string[] {
  const normalized = normalizeModelName(name);
  const keys = new Set<string>([name, normalized]);
  for (const prefix of ["light_", "room_", "floor_", "ceiling_", "door_", "window_", "furniture_"]) {
    if (normalized.startsWith(prefix)) {
      keys.add(normalized.slice(prefix.length));
    }
  }
  return [...keys];
}

