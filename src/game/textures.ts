import * as THREE from 'three';

function canvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, x: c.getContext('2d')! };
}

let glowTex: THREE.Texture | null = null;
/** Soft radial falloff, used for light pools, glows and particles. */
export function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const { c, x } = canvas(256);
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.16)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

const windowCache = new Map<string, THREE.Texture>();
/** Warm interior seen through a mullioned window. */
export function windowTexture(tint: string, cols = 2, rows = 2): THREE.Texture {
  const key = `${tint}${cols}${rows}`;
  const hit = windowCache.get(key);
  if (hit) return hit;
  const { c, x } = canvas(128);
  const g = x.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, tint);
  g.addColorStop(1, '#3a1f08');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  // faint blobs, like furniture blocking the light
  x.fillStyle = 'rgba(60,30,10,0.45)';
  x.fillRect(10, 78, 46, 50);
  x.fillRect(84, 92, 34, 36);
  x.strokeStyle = '#1a1209'; x.lineWidth = 7;
  for (let i = 1; i < cols; i++) { x.beginPath(); x.moveTo((128 / cols) * i, 0); x.lineTo((128 / cols) * i, 128); x.stroke(); }
  for (let i = 1; i < rows; i++) { x.beginPath(); x.moveTo(0, (128 / rows) * i); x.lineTo(128, (128 / rows) * i); x.stroke(); }
  x.lineWidth = 10; x.strokeRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  windowCache.set(key, t);
  return t;
}

let groundTex: THREE.Texture | null = null;
/** Mottled wet asphalt / earth, tiled across the town ground. */
export function groundTexture(): THREE.Texture {
  if (groundTex) return groundTex;
  const { c, x } = canvas(512);
  x.fillStyle = '#191b20'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) {
    const r = Math.random();
    x.fillStyle = r > 0.6 ? 'rgba(48,52,60,0.45)' : r > 0.3 ? 'rgba(10,11,14,0.6)' : 'rgba(36,34,31,0.4)';
    const s = 2 + Math.random() * 12;
    x.fillRect(Math.random() * 512, Math.random() * 512, s, s * (0.4 + Math.random()));
  }
  groundTex = new THREE.CanvasTexture(c);
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.colorSpace = THREE.SRGBColorSpace;
  return groundTex;
}

let sandTex: THREE.Texture | null = null;
export function sandTexture(): THREE.Texture {
  if (sandTex) return sandTex;
  const { c, x } = canvas(512);
  x.fillStyle = '#4a4438'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4200; i++) {
    x.fillStyle = Math.random() > 0.5 ? 'rgba(96,88,72,0.35)' : 'rgba(30,28,24,0.35)';
    const s = 1 + Math.random() * 6;
    x.fillRect(Math.random() * 512, Math.random() * 512, s, s);
  }
  sandTex = new THREE.CanvasTexture(c);
  sandTex.wrapS = sandTex.wrapT = THREE.RepeatWrapping;
  sandTex.colorSpace = THREE.SRGBColorSpace;
  return sandTex;
}

let woodTex: THREE.Texture | null = null;
export function woodTexture(): THREE.Texture {
  if (woodTex) return woodTex;
  const { c, x } = canvas(256);
  x.fillStyle = '#4e3d2c'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 70; i++) {
    x.strokeStyle = `rgba(${20 + Math.random() * 60},${14 + Math.random() * 40},${8 + Math.random() * 26},0.5)`;
    x.lineWidth = 1 + Math.random() * 3;
    const y = Math.random() * 256;
    x.beginPath(); x.moveTo(0, y);
    x.bezierCurveTo(80, y + Math.random() * 12 - 6, 170, y + Math.random() * 12 - 6, 256, y);
    x.stroke();
  }
  for (let i = 0; i < 8; i++) {
    x.strokeStyle = 'rgba(0,0,0,0.4)'; x.lineWidth = 2;
    const y = (256 / 8) * i; x.beginPath(); x.moveTo(0, y); x.lineTo(256, y); x.stroke();
  }
  woodTex = new THREE.CanvasTexture(c);
  woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
  woodTex.colorSpace = THREE.SRGBColorSpace;
  return woodTex;
}

let stoneTex: THREE.Texture | null = null;
export function stoneTexture(): THREE.Texture {
  if (stoneTex) return stoneTex;
  const { c, x } = canvas(256);
  x.fillStyle = '#6b6559'; x.fillRect(0, 0, 256, 256);
  const rows = 8, h = 256 / rows;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * 16;
    for (let i = -1; i < 8; i++) {
      const w = 32, bx = off + i * w, by = r * h;
      const v = 104 + Math.random() * 34;
      x.fillStyle = `rgb(${v},${v - 6},${v - 18})`;
      x.fillRect(bx + 1.5, by + 1.5, w - 3, h - 3);
    }
  }
  x.fillStyle = 'rgba(0,0,0,0.1)';
  for (let i = 0; i < 600; i++) x.fillRect(Math.random() * 256, Math.random() * 256, 3, 3);
  stoneTex = new THREE.CanvasTexture(c);
  stoneTex.wrapS = stoneTex.wrapT = THREE.RepeatWrapping;
  stoneTex.colorSpace = THREE.SRGBColorSpace;
  return stoneTex;
}

let moonTex: THREE.Texture | null = null;
/** The moon: a soft-edged disc with a faint halo and a few seas. */
export function moonTexture(): THREE.Texture {
  if (moonTex) return moonTex;
  const { c, x } = canvas(256);
  const halo = x.createRadialGradient(128, 128, 60, 128, 128, 128);
  halo.addColorStop(0, 'rgba(200,220,255,0.5)');
  halo.addColorStop(1, 'rgba(200,220,255,0)');
  x.fillStyle = halo; x.fillRect(0, 0, 256, 256);
  const disc = x.createRadialGradient(128, 128, 40, 128, 128, 62);
  disc.addColorStop(0, 'rgba(255,255,255,1)');
  disc.addColorStop(0.86, 'rgba(240,246,255,1)');
  disc.addColorStop(1, 'rgba(240,246,255,0)');
  x.fillStyle = disc;
  x.beginPath(); x.arc(128, 128, 62, 0, Math.PI * 2); x.fill();
  x.fillStyle = 'rgba(186,200,222,0.5)';
  for (const [mx, my, r] of [[112, 112, 16], [146, 136, 11], [122, 152, 8], [140, 106, 6]]) {
    x.beginPath(); x.arc(mx, my, r, 0, Math.PI * 2); x.fill();
  }
  moonTex = new THREE.CanvasTexture(c);
  moonTex.colorSpace = THREE.SRGBColorSpace;
  return moonTex;
}
