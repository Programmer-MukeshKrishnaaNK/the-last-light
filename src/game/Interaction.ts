import * as THREE from 'three';

export interface Interactable {
  id: string;
  pos: THREE.Vector3;
  radius: number;
  key: string;
  label: string;
  /** Optional gate — the prompt only appears when this returns true. */
  enabled: () => boolean;
  onUse: () => void;
  once?: boolean;
  used?: boolean;
  /** Requires the lantern to be lit. */
  needsLight?: boolean;
  highlight?: THREE.Object3D;
}

export class Interaction {
  items: Interactable[] = [];
  current: Interactable | null = null;

  add(i: Omit<Interactable, 'enabled'> & { enabled?: () => boolean }) {
    const item: Interactable = { enabled: () => true, ...i };
    this.items.push(item);
    return item;
  }

  remove(id: string) {
    const i = this.items.findIndex((x) => x.id === id);
    if (i >= 0) this.items.splice(i, 1);
  }

  get(id: string) { return this.items.find((x) => x.id === id); }

  update(playerPos: THREE.Vector3, t: number) {
    let best: Interactable | null = null;
    let bestD = Infinity;
    for (const it of this.items) {
      if (it.used && it.once) continue;
      if (!it.enabled()) continue;
      const d = it.pos.distanceTo(playerPos);
      if (d < it.radius && d < bestD) { best = it; bestD = d; }
      if (it.highlight) {
        const near = d < it.radius * 1.9 && it.enabled() && !(it.used && it.once);
        const m = (it.highlight as THREE.Sprite).material as THREE.SpriteMaterial;
        const target = near ? 0.3 + 0.14 * Math.sin(t * 2.4) : 0.14 + 0.06 * Math.sin(t * 1.5);
        m.opacity += (target - m.opacity) * 0.08;
      }
    }
    this.current = best;
    return best;
  }

  use() {
    const c = this.current;
    if (!c) return null;
    c.used = true;
    c.onUse();
    return c;
  }
}
