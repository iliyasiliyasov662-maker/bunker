// 3D-сцена бункера: комната, стол, персонажи в противогазах, руки от первого лица,
// жесты, помидоры, подзатыльники и карточки на столе.
import * as THREE from 'three';

const ROOM_R = 5.6;
const TABLE_R = 1.15;
const SEAT_R = 1.68;
const HEAD_Y = 1.42;
const YAW_MAX = 1.9;
const PITCH_MAX = 1.0;
const MOBILE = window.matchMedia('(max-width: 820px), (pointer: coarse)').matches;

// ---------- текстуры на canvas ----------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function concrete(ctx, w, h, base = '#4a4b4d') {
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) {
    const v = Math.floor(Math.random() * 40) - 20;
    ctx.fillStyle = `rgba(${128 + v},${128 + v},${128 + v},0.06)`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  for (let i = 0; i < 18; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = 20 + Math.random() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(20,18,15,0.35)'); g.addColorStop(1, 'rgba(20,18,15,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 6; i++) {
    const x = Math.random() * w;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(60,40,20,0.25)'); g.addColorStop(1, 'rgba(60,40,20,0)');
    ctx.fillStyle = g; ctx.fillRect(x, 0, 3 + Math.random() * 8, h * (0.3 + Math.random() * 0.6));
  }
}

function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function labelTexture(text, color) {
  return canvasTex(512, 128, (ctx, w) => {
    ctx.font = '600 56px Rubik, Arial, sans-serif';
    const tw = Math.min(ctx.measureText(text).width + 70, w - 4);
    ctx.fillStyle = 'rgba(10,10,12,0.78)';
    const x = (w - tw) / 2;
    ctx.beginPath(); ctx.roundRect(x, 18, tw, 92, 46); ctx.fill();
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x + 40, 64, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f3efe6'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(text, x + 62, 66, tw - 80);
  });
}

function drawCard(ctx, w, h, label, text, color) {
  ctx.clearRect(0, 0, w, h);
  if (!text) {
    ctx.fillStyle = '#1d1e20'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#f2b13a'; ctx.lineWidth = 10; ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.fillStyle = 'rgba(242,177,58,0.12)';
    for (let i = -h; i < w; i += 46) { ctx.beginPath(); ctx.moveTo(i, h); ctx.lineTo(i + h, 0); ctx.lineTo(i + h + 18, 0); ctx.lineTo(i + 18, h); ctx.fill(); }
    ctx.fillStyle = '#f2b13a'; ctx.font = '700 130px "Russo One", Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('?', w / 2, h / 2 + 6);
    return;
  }
  ctx.fillStyle = '#efe8d8'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = color; ctx.fillRect(0, 0, w, 64);
  ctx.fillStyle = '#111'; ctx.font = '700 40px "Russo One", Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(label.toUpperCase(), 22, 34);
  ctx.fillStyle = '#1b1b1b';
  let size = 46;
  let lines;
  do {
    ctx.font = `500 ${size}px Rubik, Arial, sans-serif`;
    lines = wrap(ctx, text, w - 44);
    size -= 3;
  } while (lines.length * (size + 8) > h - 90 && size > 20);
  ctx.textBaseline = 'top';
  lines.slice(0, 6).forEach((l, i) => ctx.fillText(l, 22, 82 + i * (size + 10)));
}

const emojiCache = {};
function emojiTexture(emoji) {
  if (emojiCache[emoji]) return emojiCache[emoji];
  return (emojiCache[emoji] = canvasTex(128, 128, (ctx) => {
    ctx.font = '96px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 64, 72);
  }));
}

let splatTex = null;
function splatTexture() {
  if (splatTex) return splatTex;
  splatTex = canvasTex(256, 256, (ctx, w, h) => {
    const blob = (x, y, r, a) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(205,30,20,${a})`); g.addColorStop(0.7, `rgba(175,20,12,${a})`); g.addColorStop(1, 'rgba(150,15,10,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    };
    blob(w / 2, h / 2, 70, 0.95);
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, d = 50 + Math.random() * 60;
      blob(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d, 8 + Math.random() * 22, 0.9);
    }
    ctx.fillStyle = 'rgba(240,200,80,0.8)';
    for (let i = 0; i < 12; i++) { ctx.beginPath(); ctx.ellipse(w / 2 + (Math.random() - 0.5) * 90, h / 2 + (Math.random() - 0.5) * 90, 5, 3, Math.random() * 3, 0, Math.PI * 2); ctx.fill(); }
  });
  return splatTex;
}

const GESTURE_EMOJI = {
  nod: '👍', shake: '🙅', shrug: '🤷', point: '👉', raise: '✋', facepalm: '🤦', laugh: '😂', think: '🤔',
  finger: '🖕', throw: '🍅', slap: '👋', hit: '💥', tomatoed: '😵',
};
const GESTURE_DUR = { throw: 0.8, slap: 0.6, hit: 0.9, tomatoed: 1.6, finger: 2.4 };

// ---------- руки с пальцами ----------
const POSES = {
  relax: [0.5, 0.55, 0.65, 0.75], fist: [1.9, 1.9, 1.9, 1.9], open: [0.05, 0.05, 0.08, 0.1],
  point: [0, 1.9, 1.9, 1.9], middle: [1.9, 0, 1.9, 1.9],
};

function makeHand(mat, left) {
  const s = left ? -1 : 1;
  const g = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.09, 0.04), mat);
  palm.position.y = -0.045; g.add(palm);
  const fingers = [];
  [0.03, 0.01, -0.01, -0.03].forEach((x, i) => {
    const piv = new THREE.Group();
    piv.position.set(x * s, -0.088, 0);
    const len = i === 1 ? 0.058 : i === 3 ? 0.038 : 0.05;
    const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.0115, len, 3, 6), mat);
    f.position.y = -len / 2 - 0.008; piv.add(f);
    g.add(piv); fingers.push(piv);
  });
  const thumb = new THREE.Group();
  thumb.position.set(0.045 * s, -0.03, 0.006);
  const tm = new THREE.Mesh(new THREE.CapsuleGeometry(0.013, 0.034, 3, 6), mat);
  tm.position.y = -0.022; thumb.add(tm);
  thumb.rotation.z = 0.6 * s;
  g.add(thumb);
  return { group: g, fingers, thumb, pose: '' };
}

function poseHand(h, name) {
  if (h.pose === name) return;
  h.pose = name;
  const p = POSES[name] || POSES.relax;
  h.fingers.forEach((f, i) => (f.rotation.x = p[i]));
  h.thumb.rotation.x = name === 'open' || name === 'relax' ? 0.15 : 1.0;
}

function makeTomato() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), new THREE.MeshStandardMaterial({ color: 0xd8261c, roughness: 0.35 }));
  body.scale.y = 0.82; g.add(body);
  const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.015, 5), new THREE.MeshStandardMaterial({ color: 0x2f7a2a, roughness: 0.6 }));
  leaf.position.y = 0.046; g.add(leaf);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.025, 5), leaf.material);
  stem.position.y = 0.06; g.add(stem);
  return g;
}

// ---------- сцена ----------
export class Scene3D {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: !MOBILE });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MOBILE ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x09090a);
    this.scene.fog = new THREE.Fog(0x09090a, 5.5, 13);
    this.camera = new THREE.PerspectiveCamera(MOBILE ? 78 : 70, 1, 0.03, 50);
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(0, 2.6, 3.5);
    this.scene.add(this.camera);

    this.yaw = 0; this.pitch = -0.22; this.fov = this.camera.fov; this.baseFov = this.fov;
    this.avatars = new Map();
    this.layoutKey = '';
    this.myId = null;
    this.state = null;
    this.clock = new THREE.Clock();
    this.onLook = null;
    this.onTarget = null;
    this.onHitMe = null;
    this.target = null;
    this.flights = [];
    this.particles = [];
    this.pending = [];
    this.myGesture = null;
    this.shake = 0;
    this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();

    this.buildRoom();
    this.buildFirstPerson();
    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------- окружение ----------
  buildRoom() {
    const s = this.scene;
    const R = ROOM_R;
    s.add(new THREE.HemisphereLight(0x8a8f99, 0x1a140e, 0.55));
    s.add(new THREE.AmbientLight(0xffffff, 0.08));

    const floorTex = canvasTex(1024, 1024, (ctx, w, h) => {
      concrete(ctx, w, h, '#2e2f31');
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 4;
      for (let i = 0; i <= w; i += 128) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); }
    });
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(2.5, 2.5);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 48), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.92 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor);

    const wallTex = canvasTex(2048, 512, (ctx, w, h) => {
      concrete(ctx, w, h, '#55575a');
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let i = 0; i < w; i += 256) ctx.fillRect(i, 0, 6, h);
      ctx.fillRect(0, h * 0.62, w, 5);
      ctx.fillStyle = 'rgba(30,60,40,0.35)'; ctx.fillRect(0, h * 0.62, w, h * 0.38);
    });
    wallTex.wrapS = THREE.RepeatWrapping; wallTex.repeat.set(2, 1);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 4, 48, 1, true),
      new THREE.MeshStandardMaterial({ map: wallTex, side: THREE.BackSide, roughness: 0.95 }));
    wall.position.y = 2; wall.receiveShadow = true; s.add(wall);

    const ceil = new THREE.Mesh(new THREE.CircleGeometry(R, 48), new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 1 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = 4; s.add(ceil);

    const beamMat = new THREE.MeshStandardMaterial({ color: 0x2a2b2d, metalness: 0.5, roughness: 0.6 });
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(R * 2, 0.22, 0.28), beamMat);
      b.position.y = 3.86; b.rotation.y = (i * Math.PI) / 4; s.add(b);
    }

    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x5b4636, metalness: 0.6, roughness: 0.45 });
    const pipeMat2 = new THREE.MeshStandardMaterial({ color: 0x3e5a49, metalness: 0.5, roughness: 0.5 });
    [[3.35, 0.09, pipeMat], [3.1, 0.06, pipeMat2], [0.35, 0.1, pipeMat2]].forEach(([y, r, m]) => {
      const p = new THREE.Mesh(new THREE.TorusGeometry(R - 0.2, r, 8, 96), m);
      p.rotation.x = Math.PI / 2; p.position.y = y; s.add(p);
    });

    // гермодверь
    const doorAng = Math.PI;
    const door = new THREE.Group();
    const stripes = canvasTex(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#d9a21b'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#151515';
      for (let i = -h; i < w + h; i += 90) { ctx.beginPath(); ctx.moveTo(i, h); ctx.lineTo(i + h, 0); ctx.lineTo(i + h + 45, 0); ctx.lineTo(i + 45, h); ctx.fill(); }
    });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3, 0.2), new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.7 }));
    frame.position.y = 1.5; door.add(frame);
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 0.98, 0.25, 40), new THREE.MeshStandardMaterial({ color: 0x6d7275, metalness: 0.85, roughness: 0.35 }));
    slab.rotation.x = Math.PI / 2; slab.position.set(0, 1.45, 0.12); door.add(slab);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.05, 10, 40), new THREE.MeshStandardMaterial({ color: 0xa82a1e, metalness: 0.5, roughness: 0.4 }));
    wheel.position.set(0, 1.45, 0.3); door.add(wheel);
    for (let i = 0; i < 3; i++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.05), wheel.material);
      sp.position.copy(wheel.position); sp.rotation.z = (i * Math.PI) / 3; door.add(sp);
    }
    door.position.set(Math.cos(doorAng) * (R - 0.25), 0, Math.sin(doorAng) * (R - 0.25));
    door.lookAt(0, 0, 0);
    s.add(door);

    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.5), new THREE.MeshStandardMaterial({
      map: canvasTex(1024, 256, (ctx, w, h) => {
        ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#d9a21b'; ctx.lineWidth = 10; ctx.strokeRect(8, 8, w - 16, h - 16);
        ctx.fillStyle = '#e4dccb'; ctx.font = '700 120px "Russo One", Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('БУНКЕР № 17', w / 2, h / 2 + 6);
      }), roughness: 0.8,
    }));
    sign.position.set(Math.cos(doorAng) * (R - 0.4), 3.3, Math.sin(doorAng) * (R - 0.4));
    sign.lookAt(0, 3.3, 0);
    s.add(sign);

    // стеллажи и бочки
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x6b5233, roughness: 0.85 });
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x3d4a33, roughness: 0.8 });
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0x3a3b3d, metalness: 0.7, roughness: 0.5 });
    [0.5, 1.4, 2.3, -0.6, -1.5].forEach((a) => {
      const g = new THREE.Group();
      for (let k = 0; k < 3; k++) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.55), shelfMat);
        plank.position.y = 0.3 + k * 0.85; g.add(plank);
        for (let j = 0; j < 3; j++) {
          if (Math.random() < 0.25) continue;
          const sz = 0.28 + Math.random() * 0.22;
          const c = new THREE.Mesh(new THREE.BoxGeometry(sz, sz, sz), Math.random() < 0.5 ? crateMat : boxMat);
          c.position.set(-0.5 + j * 0.5, 0.33 + k * 0.85 + sz / 2, 0);
          c.rotation.y = Math.random() * 0.3; c.castShadow = true; g.add(c);
        }
      }
      [-0.78, 0.78].forEach((x) => { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.3, 0.55), shelfMat); leg.position.set(x, 1.15, 0); g.add(leg); });
      g.position.set(Math.cos(a) * (R - 0.45), 0, Math.sin(a) * (R - 0.45));
      g.lookAt(0, 0, 0);
      s.add(g);
    });
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x2f5a3a, metalness: 0.4, roughness: 0.55 });
    [2.85, 3.45, -2.6].forEach((a, i) => {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 20), i === 1 ? new THREE.MeshStandardMaterial({ color: 0x8a2b1e, metalness: 0.4, roughness: 0.6 }) : barrelMat);
      b.position.set(Math.cos(a) * (R - 0.6), 0.45, Math.sin(a) * (R - 0.6)); b.castShadow = true; s.add(b);
    });

    // стол
    const woodTex = canvasTex(1024, 1024, (ctx, w, h) => {
      ctx.fillStyle = '#4a3220'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 140; i++) {
        ctx.strokeStyle = `rgba(${20 + Math.random() * 30},${12 + Math.random() * 15},5,${0.15 + Math.random() * 0.25})`;
        ctx.lineWidth = 1 + Math.random() * 3;
        ctx.beginPath(); const y = Math.random() * h; ctx.moveTo(0, y);
        for (let x = 0; x <= w; x += 64) ctx.lineTo(x, y + Math.sin(x / 90 + i) * 8);
        ctx.stroke();
      }
    });
    const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(TABLE_R, TABLE_R, 0.08, 64), new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.65 }));
    tableTop.position.y = 0.78; tableTop.castShadow = true; tableTop.receiveShadow = true; s.add(tableTop);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(TABLE_R, 0.04, 8, 80), new THREE.MeshStandardMaterial({ color: 0x2b1c11, roughness: 0.6 }));
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.78; s.add(rim);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.35, 0.74, 20), new THREE.MeshStandardMaterial({ color: 0x232323, metalness: 0.6, roughness: 0.5 }));
    leg.position.y = 0.37; s.add(leg);

    // радио в центре
    const radio = new THREE.Group();
    const rb = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.18), new THREE.MeshStandardMaterial({ color: 0x3b4a3a, roughness: 0.6, metalness: 0.3 }));
    rb.position.y = 0.1; rb.castShadow = true; radio.add(rb);
    const grill = new THREE.Mesh(new THREE.CircleGeometry(0.065, 20), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    grill.position.set(-0.08, 0.1, 0.091); radio.add(grill);
    this.radioLamp = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 10), new THREE.MeshStandardMaterial({ color: 0x55ff66, emissive: 0x22ff44, emissiveIntensity: 2 }));
    this.radioLamp.position.set(0.1, 0.14, 0.092); radio.add(this.radioLamp);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.45, 6), new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 1 }));
    ant.position.set(0.13, 0.4, 0); ant.rotation.z = -0.3; radio.add(ant);
    radio.position.y = 0.82; radio.rotation.y = 0.6; s.add(radio);

    // лампа над столом
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1, 6), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    cord.position.y = 3.5; s.add(cord);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.3, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x2e4a3a, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide }));
    shade.position.y = 2.9; s.add(shade);
    this.bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 16), new THREE.MeshStandardMaterial({ color: 0xfff0c8, emissive: 0xffd28a, emissiveIntensity: 3 }));
    this.bulb.position.y = 2.77; s.add(this.bulb);
    this.lamp = new THREE.SpotLight(0xffd59a, 45, 10, Math.PI / 2.5, 0.55, 1.6);
    this.lamp.position.set(0, 2.76, 0);
    this.lamp.target.position.set(0, 0, 0);
    this.lamp.castShadow = true;
    this.lamp.shadow.mapSize.set(MOBILE ? 512 : 1024, MOBILE ? 512 : 1024);
    this.lamp.shadow.bias = -0.0005;
    s.add(this.lamp, this.lamp.target);
    this.fill = new THREE.PointLight(0xffc98a, 3.5, 8, 1.8);
    this.fill.position.set(0, 2.6, 0); s.add(this.fill);

    this.redLights = [];
    [Math.PI * 0.5, Math.PI * 1.5, Math.PI].forEach((a) => {
      const pos = new THREE.Vector3(Math.cos(a) * (R - 0.15), a === Math.PI ? 3.6 : 3.1, Math.sin(a) * (R - 0.15));
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), new THREE.MeshStandardMaterial({ color: 0xff2a1a, emissive: 0xff2010, emissiveIntensity: 2 }));
      bulb.position.copy(pos); s.add(bulb);
      const l = new THREE.PointLight(0xff2a14, 3, 6, 2);
      l.position.copy(pos).multiplyScalar(0.93); s.add(l);
      this.redLights.push({ l, bulb });
    });

    this.speakerLight = new THREE.SpotLight(0xffe2a8, 0, 5, 0.3, 0.6, 1);
    this.speakerLight.position.set(0, 3.8, 0);
    s.add(this.speakerLight, this.speakerLight.target);

    this.particleGeo = new THREE.SphereGeometry(0.014, 6, 5);
    this.particleMat = new THREE.MeshStandardMaterial({ color: 0xc8231a, roughness: 0.4 });
  }

  // ---------- свои руки ----------
  buildFirstPerson() {
    this.fp = new THREE.Group();
    this.camera.add(this.fp);
    this.fpSleeve = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.75 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x1f2022, roughness: 0.55 });
    this.fpArms = {};
    for (const side of ['L', 'R']) {
      const s = side === 'R' ? 1 : -1;
      const piv = new THREE.Group();
      piv.rotation.order = 'YXZ';
      piv.position.set(0.27 * s, -0.22, 0.02);
      const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.36, 4, 12), this.fpSleeve);
      sleeve.position.y = -0.22; piv.add(sleeve);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 14), glove);
      cuff.position.y = -0.42; piv.add(cuff);
      const wrist = new THREE.Group();
      wrist.position.y = -0.44; piv.add(wrist);
      const hand = makeHand(glove, side === 'L');
      hand.group.scale.setScalar(1.25);
      wrist.add(hand.group);
      poseHand(hand, 'relax');
      this.fp.add(piv);
      this.fpArms[side] = { piv, wrist, hand, s };
    }
    this.fpTomato = makeTomato();
    this.fpTomato.position.set(0, -0.11, 0.02);
    this.fpTomato.visible = false;
    this.fpArms.R.wrist.add(this.fpTomato);
    this.fp.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
  }

  // ---------- персонажи ----------
  seatPos(i, n) {
    const a = (i / n) * Math.PI * 2 + Math.PI / 2;
    return { a, x: Math.cos(a) * SEAT_R, z: Math.sin(a) * SEAT_R };
  }

  makeAvatar(p) {
    const color = new THREE.Color(p.color);
    const g = new THREE.Group();

    const chairMat = new THREE.MeshStandardMaterial({ color: 0x2b2c2e, metalness: 0.6, roughness: 0.5 });
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.06, 0.52), chairMat);
    seat.position.set(0, 0.5, -0.05); seat.castShadow = true; g.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.66, 0.06), chairMat);
    back.position.set(0, 0.85, -0.3); back.castShadow = true; g.add(back);
    for (const [x, z] of [[-0.24, 0.17], [0.24, 0.17], [-0.24, -0.27], [0.24, -0.27]]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), chairMat);
      l.position.set(x, 0.25, z); g.add(l);
    }

    const body = new THREE.Group();
    g.add(body);
    const clothes = new THREE.MeshStandardMaterial({ color, roughness: 0.75 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.4, 6, 16), clothes);
    torso.position.y = 0.98; torso.scale.set(1, 1, 0.75); torso.castShadow = true; body.add(torso);
    const legsMat = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.8 });
    for (const x of [-0.11, 0.11]) {
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.3, 4, 10), legsMat);
      thigh.rotation.x = Math.PI / 2; thigh.position.set(x, 0.6, 0.1); body.add(thigh);
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.34, 4, 10), legsMat);
      shin.position.set(x, 0.32, 0.27); body.add(shin);
    }

    // голова в противогазе — лиц нет ни у кого
    const head = new THREE.Group();
    head.position.y = HEAD_Y;
    head.rotation.order = 'YXZ';
    body.add(head);
    const rubber = new THREE.MeshStandardMaterial({ color: 0x2c302b, roughness: 0.78 });
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 18), rubber);
    skull.castShadow = true; head.add(skull);
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.207, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.6), clothes);
    hood.rotation.x = -0.35; head.add(hood);
    const glass = new THREE.MeshStandardMaterial({ color: 0x0d1a1e, metalness: 0.7, roughness: 0.08, emissive: 0x0c2a33, emissiveIntensity: 0.6 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x8a8d8f, metalness: 0.9, roughness: 0.3 });
    for (const x of [-0.075, 0.075]) {
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.03, 20), glass);
      lens.rotation.x = Math.PI / 2; lens.position.set(x, 0.035, 0.172); lens.rotation.z = x * 2; head.add(lens);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.011, 8, 20), metal);
      ring.position.set(x, 0.035, 0.188); ring.rotation.y = x * 2; head.add(ring);
    }
    const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.062, 0.09, 16), rubber);
    snout.rotation.x = Math.PI / 2 + 0.45; snout.position.set(0, -0.075, 0.18); head.add(snout);
    const canister = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.1, 18), new THREE.MeshStandardMaterial({ color: 0x4d5c3b, metalness: 0.4, roughness: 0.5 }));
    canister.rotation.x = Math.PI / 2 + 0.45; canister.position.set(0, -0.12, 0.27); canister.castShadow = true; head.add(canister);
    for (const d of [0.25, 0.3]) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.059, 0.006, 6, 18), metal);
      rib.rotation.x = 0.45; rib.position.set(0, -0.12 + (d - 0.27) * 0.45, d); head.add(rib);
    }
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.012, 6, 30), rubber);
    strap.rotation.y = Math.PI / 2; strap.rotation.z = 0.2; head.add(strap);

    const splat = new THREE.Sprite(new THREE.SpriteMaterial({ map: splatTexture(), transparent: true, depthWrite: false, opacity: 0 }));
    splat.scale.set(0.38, 0.38, 1); splat.position.set(0, 0.02, 0.24); head.add(splat);

    const glove = new THREE.MeshStandardMaterial({ color: 0x1f2022, roughness: 0.55 });
    const arms = {}, hands = {}, wrists = {};
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? 1 : -1; // левая рука персонажа — +X (он смотрит по +Z)
      const pivot = new THREE.Group();
      pivot.rotation.order = 'YXZ';
      pivot.position.set(0.3 * sx, 1.2, 0);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.36, 4, 10), clothes);
      arm.position.y = -0.22; arm.castShadow = true; pivot.add(arm);
      const wrist = new THREE.Group();
      wrist.position.y = -0.44; pivot.add(wrist);
      const hand = makeHand(glove, side === 'L');
      wrist.add(hand.group);
      poseHand(hand, 'relax');
      body.add(pivot);
      arms[side] = pivot; hands[side] = hand; wrists[side] = wrist;
    }

    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(p.name, p.color), depthWrite: false, transparent: true }));
    label.scale.set(0.9, 0.225, 1); label.position.y = 1.92; g.add(label);

    const emoji = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture('👍'), transparent: true, depthWrite: false, opacity: 0 }));
    emoji.scale.set(0.36, 0.36, 1); emoji.position.y = 2.2; g.add(emoji);

    const out = new THREE.Sprite(new THREE.SpriteMaterial({
      map: canvasTex(512, 128, (ctx, w, h) => {
        ctx.fillStyle = 'rgba(140,20,10,0.85)'; ctx.beginPath(); ctx.roundRect(40, 14, w - 80, h - 28, 20); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = '700 64px "Russo One", Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('ВЫГНАН', w / 2, h / 2 + 4);
      }), transparent: true, depthWrite: false,
    }));
    out.scale.set(0.8, 0.2, 1); out.position.y = 1.1; out.visible = false; g.add(out);

    const ring = new THREE.Mesh(new THREE.RingGeometry(0.38, 0.45, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; g.add(ring);

    const cards = [];
    for (let i = 0; i < 8; i++) {
      const c = document.createElement('canvas');
      c.width = 512; c.height = 340;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.66), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide }));
      cards.push({ mesh: m, canvas: c, tex, key: null });
      this.scene.add(m);
    }

    return {
      group: g, body, head, arms, hands, wrists, label, emoji, out, ring, cards, clothes, splat,
      splatT: 0, yaw: 0, pitch: 0, ty: 0, tp: 0, gesture: null, exiled: false, seat: 0, angle: 0, color: p.color,
    };
  }

  placeCards(av, i, n) {
    const { a } = this.seatPos(i, n);
    const span = Math.min(1.0, ((Math.PI * 2) / n) * 0.85);
    const r0 = TABLE_R - 0.2, r1 = TABLE_R - 0.42;
    const cw = Math.min(0.24, (span * r0) / 4.2);
    av.cards.forEach((c, k) => {
      const row = k < 4 ? 0 : 1;
      const col = k % 4;
      const r = row === 0 ? r0 : r1;
      const ang = a + ((col - 1.5) * cw * 1.08) / r;
      const y = 0.82 + cw * 0.33 + (row === 0 ? 0.03 : 0);
      c.mesh.scale.set(cw, cw, 1);
      c.mesh.position.set(Math.cos(ang) * r, y, Math.sin(ang) * r);
      c.mesh.lookAt(0, y, 0);
      c.mesh.rotateX(-0.35);
    });
  }

  setPlayers(state, myId) {
    this.state = state;
    this.myId = myId;
    const players = state.players;
    const n = Math.max(players.length, 2);
    const key = players.map((p) => p.id).join(',');
    if (key !== this.layoutKey) {
      for (const [id, av] of this.avatars) if (!players.find((p) => p.id === id)) {
        this.scene.remove(av.group);
        av.cards.forEach((c) => this.scene.remove(c.mesh));
        this.avatars.delete(id);
      }
      players.forEach((p, i) => {
        let av = this.avatars.get(p.id);
        if (!av) { av = this.makeAvatar(p); this.avatars.set(p.id, av); this.scene.add(av.group); }
        const { a, x, z } = this.seatPos(i, n);
        av.seat = i; av.angle = a;
        av.group.position.set(x, 0, z);
        av.group.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a));
        this.placeCards(av, i, n);
        av.ty = p.yaw || 0; av.tp = p.pitch || 0;
      });
      this.layoutKey = key;
    }

    const me = players.find((p) => p.id === myId);
    if (me) this.fpSleeve.color.set(me.color);
    this.fp.visible = !!me && !me.exiled;

    const labels = state.labels || {};
    const keys = state.keys || [];
    for (const p of players) {
      const av = this.avatars.get(p.id);
      if (!av) continue;
      const isMe = p.id === myId;
      av.exiled = p.exiled;
      av.body.visible = !p.exiled && !isMe;
      av.label.visible = !isMe && !p.exiled;
      av.out.visible = p.exiled;
      av.ring.material.opacity = p.connected ? 0.4 : 0.08;
      av.label.material.opacity = p.connected ? 1 : 0.45;
      keys.forEach((k, idx) => {
        const c = av.cards[idx];
        if (!c) return;
        const txt = p.revealed && p.revealed[k];
        const ck = (txt || '') + '|' + (state.phase === 'lobby' ? 'L' : '');
        if (c.key === ck) return;
        c.key = ck;
        c.mesh.visible = state.phase !== 'lobby';
        drawCard(c.canvas.getContext('2d'), c.canvas.width, c.canvas.height, labels[k] || '', txt, p.color);
        c.tex.needsUpdate = true;
      });
    }
    this.applyCamera();
  }

  setPose(id, yaw, pitch) {
    const av = this.avatars.get(id);
    if (av) { av.ty = yaw; av.tp = pitch; }
  }

  gesture(id, g) {
    if (!GESTURE_EMOJI[g]) return;
    if (id === this.myId) this.myGesture = { g, t0: performance.now() };
    const av = this.avatars.get(id);
    if (!av) return;
    av.gesture = { g, t0: performance.now() };
    av.emoji.material.map = emojiTexture(GESTURE_EMOJI[g]);
    av.emoji.material.needsUpdate = true;
  }

  // ---------- броски и подзатыльники ----------
  headPos(id, out) {
    if (id === this.myId) return this.camera.getWorldPosition(out);
    const av = this.avatars.get(id);
    if (!av) return null;
    return av.head.getWorldPosition(out);
  }

  fx(kind, fromId, toId) {
    const target = this.avatars.get(toId);
    if (!target) return;
    if (kind === 'throw') {
      this.gesture(fromId, 'throw');
      this.pending.push({
        at: performance.now() + 330,
        fn: () => {
          const from = new THREE.Vector3();
          if (fromId === this.myId) {
            this.fpTomato.getWorldPosition(from);
          } else {
            const av = this.avatars.get(fromId);
            if (!av) return;
            if (av.exiled) from.set(Math.cos(av.angle) * (ROOM_R * 0.8), 3.5, Math.sin(av.angle) * (ROOM_R * 0.8));
            else av.wrists.R.getWorldPosition(from);
          }
          const mesh = makeTomato();
          mesh.position.copy(from);
          this.scene.add(mesh);
          const to = new THREE.Vector3();
          this.headPos(toId, to);
          const dist = from.distanceTo(to);
          this.flights.push({ mesh, from, toId, t0: performance.now(), dur: 380 + dist * 160, arc: 0.15 + dist * 0.12, fromId });
        },
      });
    } else if (kind === 'slap') {
      const fromAv = this.avatars.get(fromId);
      let side = 1;
      if (fromAv) {
        // в какую сторону махать: сосед слева или справа
        const diff = ((target.seat - fromAv.seat) % this.avatars.size + this.avatars.size) % this.avatars.size;
        side = diff === 1 ? 1 : -1;
      }
      this.slapSide = side;
      this.gesture(fromId, 'slap');
      if (fromAv) fromAv.slapSide = side;
      this.pending.push({
        at: performance.now() + 260,
        fn: () => {
          this.gesture(toId, 'hit');
          if (toId === this.myId) { this.shake = 1; if (this.onHitMe) this.onHitMe('slap', fromId); }
        },
      });
    }
  }

  splash(toId, pos, fromId) {
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(this.particleGeo, this.particleMat);
      m.position.copy(pos);
      this.scene.add(m);
      this.particles.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 2.2, Math.random() * 1.6, (Math.random() - 0.5) * 2.2), t0: performance.now() });
    }
    const av = this.avatars.get(toId);
    if (av) { av.splatT = performance.now(); this.gesture(toId, 'tomatoed'); }
    if (toId === this.myId) { this.shake = 0.6; if (this.onHitMe) this.onHitMe('throw', fromId); }
  }

  // ---------- камера и управление ----------
  myAvatar() { return this.myId ? this.avatars.get(this.myId) : null; }

  applyCamera() {
    const av = this.myAvatar();
    if (!av) {
      this.camera.position.set(0, 2.8, 3.8);
      this.camera.rotation.set(-0.5 + this.pitch * 0.3, this.yaw * 0.5, 0);
      return;
    }
    const a = av.angle;
    const facing = Math.atan2(Math.cos(a), Math.sin(a));
    if (av.exiled) {
      this.camera.position.set(Math.cos(a) * ROOM_R * 0.8, 3.5, Math.sin(a) * ROOM_R * 0.8);
      this.camera.rotation.set(-0.6 + this.pitch * 0.6, facing + this.yaw, 0);
    } else {
      this.camera.position.set(Math.cos(a) * (SEAT_R - 0.04), HEAD_Y + 0.04, Math.sin(a) * (SEAT_R - 0.04));
      this.camera.rotation.set(this.pitch, facing + this.yaw, 0);
    }
  }

  bindInput() {
    const el = this.renderer.domElement;
    el.style.touchAction = 'none';
    let drag = null;
    el.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointerup', () => { drag = null; });
    el.addEventListener('pointercancel', () => { drag = null; });
    el.addEventListener('pointermove', (e) => {
      if (document.pointerLockElement === el) return this.look(e.movementX, e.movementY);
      if (!drag || e.pointerId !== drag.id) return;
      const k = e.pointerType === 'touch' ? 1.5 : 1;
      this.look((e.clientX - drag.x) * k, (e.clientY - drag.y) * k);
      drag.x = e.clientX; drag.y = e.clientY;
    });
    if (!MOBILE) el.addEventListener('dblclick', () => { if (el.requestPointerLock) el.requestPointerLock(); });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.fov = Math.max(28, Math.min(85, this.fov + Math.sign(e.deltaY) * 4));
      this.camera.fov = this.fov; this.camera.updateProjectionMatrix();
    }, { passive: false });
  }

  look(dx, dy) {
    const k = 0.0042 * (this.fov / 70);
    this.yaw = Math.max(-YAW_MAX, Math.min(YAW_MAX, this.yaw - dx * k));
    this.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, this.pitch - dy * k));
    this.applyCamera();
    if (this.onLook) this.onLook(this.yaw, this.pitch);
  }

  zoom(delta) {
    this.fov = Math.max(28, Math.min(85, this.fov + delta));
    this.camera.fov = this.fov; this.camera.updateProjectionMatrix();
  }

  // на кого я смотрю
  updateTarget() {
    let best = null, bestAng = 0.33;
    const cam = this.camera.getWorldPosition(this._v1);
    const fwd = this.camera.getWorldDirection(this._v2);
    for (const [id, av] of this.avatars) {
      if (id === this.myId || av.exiled) continue;
      const hp = av.head.getWorldPosition(this._v3).sub(cam);
      const d = hp.length();
      if (!d) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, hp.dot(fwd) / d)));
      if (ang < bestAng) { bestAng = ang; best = id; }
    }
    if (best !== this.target) {
      this.target = best;
      if (this.onTarget) this.onTarget(best);
    }
  }

  // ---------- кадр ----------
  animateFirstPerson(t, now) {
    const A = this.fpArms;
    const base = { R: { x: 1.45, y: 0.34, z: 0, w: 0, pose: 'relax' }, L: { x: 1.45, y: -0.34, z: 0, w: 0, pose: 'relax' } };
    const bob = Math.sin(t * 1.7) * 0.012;
    let camX = 0, camY = 0;
    this.fpTomato.visible = false;
    const G = this.myGesture;
    if (G) {
      const dt = (now - G.t0) / 1000;
      const dur = GESTURE_DUR[G.g] || 1.8;
      if (dt > dur) this.myGesture = null;
      else {
        const k = dt / dur;
        const env = Math.sin(Math.PI * Math.min(1, k * 1.15));
        const R = base.R, L = base.L;
        switch (G.g) {
          case 'raise': R.x = 1.45 + 1.4 * env; R.y = 0.2; R.pose = 'open'; break;
          case 'point': R.x = 1.45 + 0.15 * env; R.y = 0.34 - 0.24 * env; R.pose = 'point'; break;
          case 'finger': R.x = 1.45 + 0.35 * env; R.y = 0.34 - 0.2 * env; R.w = 1.45 * env; R.pose = 'middle'; break;
          case 'shrug': R.x = L.x = 1.45 - 0.35 * env; R.z = 0.6 * env; L.z = -0.6 * env; R.pose = L.pose = 'open'; camY = 0.04 * env; break;
          case 'facepalm': R.x = 1.45 + 0.95 * env; R.y = 0.34 + 0.45 * env; R.w = 0.8 * env; R.pose = 'open'; camX = -0.15 * env; break;
          case 'think': R.x = 1.45 + 0.6 * env; R.y = 0.34 + 0.3 * env; R.w = 1.0 * env; R.pose = 'fist'; break;
          case 'nod': camX = Math.sin(dt * 14) * 0.12 * (1 - k); R.pose = 'fist'; R.w = -0.4 * env; break;
          case 'shake': camY = Math.sin(dt * 16) * 0.12 * (1 - k); break;
          case 'laugh': camX = -Math.abs(Math.sin(dt * 18)) * 0.05 * env; break;
          case 'throw': {
            this.fpTomato.visible = k < 0.42;
            const wind = k < 0.35 ? k / 0.35 : Math.max(0, 1 - (k - 0.35) / 0.15);
            const fwd = k < 0.35 ? 0 : Math.sin(Math.PI * Math.min(1, (k - 0.35) / 0.65));
            R.x = 1.45 + 1.3 * wind + 0.1 * fwd; R.y = 0.34 - 0.1 * fwd; R.z = 0.2 * wind;
            R.pose = k < 0.42 ? 'fist' : 'open';
            break;
          }
          case 'slap': {
            const sw = Math.sin(Math.PI * Math.min(1, k * 1.3));
            R.x = 1.5; R.y = 0.34 + (this.slapSide || 1) * 0.9 * (k < 0.4 ? -k : sw - 0.4); R.pose = 'open'; R.w = -0.3; break;
          }
          case 'hit': camX = 0.25 * env; break;
          case 'tomatoed': camX = -0.15 * env; break;
        }
      }
    }
    for (const side of ['L', 'R']) {
      const a = A[side], b = base[side];
      a.piv.rotation.x += (b.x - a.piv.rotation.x) * 0.35;
      a.piv.rotation.y += (b.y - a.piv.rotation.y) * 0.35;
      a.piv.rotation.z += (b.z - a.piv.rotation.z) * 0.35;
      a.wrist.rotation.x += (b.w - a.wrist.rotation.x) * 0.35;
      a.piv.position.y = -0.22 + bob;
      poseHand(a.hand, b.pose);
    }
    // тряска и кивки камеры
    this.shake *= 0.9;
    const sh = this.shake;
    this.camera.rotation.x += camX + (Math.random() - 0.5) * 0.06 * sh;
    this.camera.rotation.y += camY + (Math.random() - 0.5) * 0.06 * sh;
  }

  frame() {
    const t = this.clock.getElapsedTime();
    const now = performance.now();

    // отложенные действия
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (now >= this.pending[i].at) { const p = this.pending.splice(i, 1)[0]; p.fn(); }
    }

    const flick = Math.random() < 0.012 ? 0.25 : 1;
    this.lamp.intensity = 45 * flick * (0.96 + Math.sin(t * 13) * 0.02);
    this.fill.intensity = 3.5 * flick;
    this.bulb.material.emissiveIntensity = 3 * flick;
    this.redLights.forEach((r, i) => {
      const v = 0.5 + 0.5 * Math.sin(t * 2.2 + i * 2);
      r.l.intensity = 0.8 + v * 2.4; r.bulb.material.emissiveIntensity = 0.6 + v * 2.2;
    });
    this.radioLamp.material.emissiveIntensity = 1 + Math.abs(Math.sin(t * 4));

    const sp = this.state && this.state.speaker && this.avatars.get(this.state.speaker);
    if (sp && this.state.phase === 'reveal' && this.state.speaker !== this.myId) {
      this.speakerLight.intensity = 25;
      this.speakerLight.target.position.copy(sp.group.position);
      this.speakerLight.target.position.y = 1;
      this.speakerLight.target.updateMatrixWorld();
    } else this.speakerLight.intensity = 0;

    for (const [id, av] of this.avatars) {
      av.yaw += (av.ty - av.yaw) * 0.18;
      av.pitch += (av.tp - av.pitch) * 0.18;
      let hy = av.yaw * 0.85, hx = -av.pitch * 0.8;
      const bodyY = av.yaw * 0.18;
      let L = { x: -0.8, y: 0, z: 0, w: 0, pose: 'relax' }, R = { x: -0.8, y: 0, z: 0, w: 0, pose: 'relax' };
      let bob = Math.sin(t * 1.6 + av.seat) * 0.008;
      let emojiOp = 0;

      if (av.gesture) {
        const dt = (now - av.gesture.t0) / 1000;
        const dur = GESTURE_DUR[av.gesture.g] || 1.8;
        if (dt > dur) av.gesture = null;
        else {
          const k = dt / dur;
          const env = Math.sin(Math.PI * Math.min(1, k * 1.15));
          emojiOp = Math.min(1, (1 - k) * 3);
          const rest = (v) => v - 0.8 * (1 - env);
          switch (av.gesture.g) {
            case 'nod': hx += Math.sin(dt * 14) * 0.35 * (1 - k); R.pose = 'fist'; break;
            case 'shake': hy += Math.sin(dt * 16) * 0.45 * (1 - k); break;
            case 'shrug':
              L = { x: -0.6 * env, y: 0, z: 1.1 * env, w: 0, pose: 'open' }; R = { x: -0.6 * env, y: 0, z: -1.1 * env, w: 0, pose: 'open' };
              hx += 0.1 * env; bob += 0.05 * env; break;
            case 'point': R = { x: rest(-1.55 * env), y: av.yaw * env, z: 0.15, w: 0, pose: 'point' }; break;
            case 'raise': R = { x: rest(-3.0 * env), y: 0, z: -0.2 * env, w: 0, pose: 'open' }; break;
            case 'facepalm': R = { x: rest(-2.5 * env), y: 0, z: 0.55 * env, w: 0, pose: 'open' }; hx += 0.3 * env; break;
            case 'laugh': hx -= 0.35 * env; bob += Math.abs(Math.sin(dt * 18)) * 0.05 * env; break;
            case 'think': R = { x: rest(-2.2 * env), y: 0, z: 0.35 * env, w: 0, pose: 'fist' }; hy += 0.25 * env; break;
            case 'finger': R = { x: rest(-1.9 * env), y: av.yaw * 0.7 * env, z: 0.1 * env, w: -1.5 * env, pose: 'middle' }; break;
            case 'throw': {
              const wind = k < 0.4 ? k / 0.4 : Math.max(0, 1 - (k - 0.4) / 0.2);
              R = { x: -0.8 - 2.2 * wind - 0.6 * (k > 0.4 ? env : 0), y: av.yaw * 0.8, z: -0.2 * wind, w: 0, pose: k < 0.42 ? 'fist' : 'open' };
              break;
            }
            case 'slap': {
              const s = av.slapSide || 1;
              R = { x: -1.6, y: -s * (k < 0.35 ? -0.4 * (k / 0.35) : 1.3 * env), z: 0, w: 0, pose: 'open' };
              hy += -s * 0.25 * env; break;
            }
            case 'hit': hx += Math.sin(Math.min(1, dt * 6) * Math.PI) * 0.6; bob -= 0.03 * env; break;
            case 'tomatoed': hx -= 0.45 * env; hy += Math.sin(dt * 10) * 0.2 * (1 - k); break;
          }
        }
      }
      av.head.rotation.set(hx, hy, 0);
      av.body.rotation.y = bodyY;
      av.body.position.y = bob;
      av.arms.L.rotation.set(L.x, L.y, L.z);
      av.arms.R.rotation.set(R.x, R.y, R.z);
      av.wrists.L.rotation.x = L.w; av.wrists.R.rotation.x = R.w;
      poseHand(av.hands.L, L.pose); poseHand(av.hands.R, R.pose);
      av.emoji.material.opacity = id === this.myId ? 0 : emojiOp;
      av.emoji.position.y = 2.2 + (1 - emojiOp) * 0.15;

      // пятно от помидора на противогазе
      if (av.splatT) {
        const age = (now - av.splatT) / 1000;
        av.splat.material.opacity = age < 3 ? 1 : Math.max(0, 1 - (age - 3) / 2);
        if (age > 5) av.splatT = 0;
      } else av.splat.material.opacity = 0;

      const speaking = this.state && this.state.speaker === id && this.state.phase === 'reveal';
      const targeted = this.target === id;
      av.ring.scale.setScalar(speaking ? 1.15 + Math.sin(t * 5) * 0.08 : targeted ? 1.08 : 1);
      av.label.scale.set(targeted ? 1.05 : 0.9, targeted ? 0.2625 : 0.225, 1);
    }

    // летящие помидоры
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      const k = Math.min(1, (now - f.t0) / f.dur);
      const to = this.headPos(f.toId, this._v1) || f.from;
      f.mesh.position.lerpVectors(f.from, to, k);
      f.mesh.position.y += Math.sin(Math.PI * k) * f.arc;
      f.mesh.rotation.x += 0.3; f.mesh.rotation.z += 0.2;
      if (k >= 1) {
        this.scene.remove(f.mesh);
        this.flights.splice(i, 1);
        this.splash(f.toId, to.clone(), f.fromId);
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      const age = (now - p.t0) / 1000;
      p.v.y -= 9.8 * 0.016;
      p.m.position.addScaledVector(p.v, 0.016);
      if (age > 1 || p.m.position.y < 0) { this.scene.remove(p.m); this.particles.splice(i, 1); }
    }

    this.applyCamera();
    if (this.fp.visible) this.animateFirstPerson(t, now);
    this.updateTarget();
    this.renderer.render(this.scene, this.camera);
  }
}
