// 3D-сцена бункера: комната, стол, персонажи, жесты, карточки на столе.
import * as THREE from 'three';

const TABLE_R = 1.9;
const SEAT_R = 2.5;
const HEAD_Y = 1.42;
const YAW_MAX = 1.7;
const PITCH_MAX = 1.0;

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
  return canvasTex(512, 128, (ctx, w, h) => {
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
  let size = 44;
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

const GESTURE_EMOJI = { nod: '👍', shake: '🙅', shrug: '🤷', point: '👉', raise: '✋', facepalm: '🤦', laugh: '😂', think: '🤔' };

// ---------- сцена ----------
export class Scene3D {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x09090a);
    this.scene.fog = new THREE.Fog(0x09090a, 7, 17);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 60);
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(0, 2.6, 4.5);

    this.yaw = 0; this.pitch = -0.18; this.fov = 70;
    this.avatars = new Map();
    this.layoutKey = '';
    this.myId = null;
    this.state = null;
    this.clock = new THREE.Clock();
    this.onLook = null;

    this.buildRoom();
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
    s.add(new THREE.HemisphereLight(0x8a8f99, 0x1a140e, 0.55));
    s.add(new THREE.AmbientLight(0xffffff, 0.08));

    // пол
    const floorTex = canvasTex(1024, 1024, (ctx, w, h) => {
      concrete(ctx, w, h, '#2e2f31');
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 4;
      for (let i = 0; i <= w; i += 128) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); }
    });
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(3, 3);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(7.2, 48), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.92 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor);

    // стены
    const wallTex = canvasTex(2048, 512, (ctx, w, h) => {
      concrete(ctx, w, h, '#55575a');
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let i = 0; i < w; i += 256) ctx.fillRect(i, 0, 6, h);
      ctx.fillRect(0, h * 0.62, w, 5);
      ctx.fillStyle = 'rgba(30,60,40,0.35)'; ctx.fillRect(0, h * 0.62, w, h * 0.38);
    });
    wallTex.wrapS = THREE.RepeatWrapping; wallTex.repeat.set(2, 1);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(7.2, 7.2, 4.4, 48, 1, true),
      new THREE.MeshStandardMaterial({ map: wallTex, side: THREE.BackSide, roughness: 0.95 }));
    wall.position.y = 2.2; wall.receiveShadow = true; s.add(wall);

    const ceil = new THREE.Mesh(new THREE.CircleGeometry(7.2, 48), new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 1 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = 4.4; s.add(ceil);

    // балки на потолке
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x2a2b2d, metalness: 0.5, roughness: 0.6 });
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(14.2, 0.25, 0.3), beamMat);
      b.position.y = 4.25; b.rotation.y = (i * Math.PI) / 4; s.add(b);
    }

    // трубы вдоль стен
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x5b4636, metalness: 0.6, roughness: 0.45 });
    const pipeMat2 = new THREE.MeshStandardMaterial({ color: 0x3e5a49, metalness: 0.5, roughness: 0.5 });
    [[3.7, 0.09, pipeMat], [3.45, 0.06, pipeMat2], [0.35, 0.1, pipeMat2]].forEach(([y, r, m]) => {
      const p = new THREE.Mesh(new THREE.TorusGeometry(7.0, r, 8, 96), m);
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
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.2, 0.2), new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.7 }));
    frame.position.y = 1.6; door.add(frame);
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.25, 40), new THREE.MeshStandardMaterial({ color: 0x6d7275, metalness: 0.85, roughness: 0.35 }));
    slab.rotation.x = Math.PI / 2; slab.position.set(0, 1.55, 0.12); door.add(slab);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 10, 40), new THREE.MeshStandardMaterial({ color: 0xa82a1e, metalness: 0.5, roughness: 0.4 }));
    wheel.position.set(0, 1.55, 0.3); door.add(wheel);
    for (let i = 0; i < 3; i++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.05, 0.05), wheel.material);
      sp.position.copy(wheel.position); sp.rotation.z = (i * Math.PI) / 3; door.add(sp);
    }
    door.position.set(Math.cos(doorAng) * 6.95, 0, Math.sin(doorAng) * 6.95);
    door.lookAt(0, 0, 0);
    s.add(door);
    this.doorWheel = wheel;

    // табличка
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.55), new THREE.MeshStandardMaterial({
      map: canvasTex(1024, 256, (ctx, w, h) => {
        ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#d9a21b'; ctx.lineWidth = 10; ctx.strokeRect(8, 8, w - 16, h - 16);
        ctx.fillStyle = '#e4dccb'; ctx.font = '700 120px "Russo One", Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('БУНКЕР № 17', w / 2, h / 2 + 6);
      }), roughness: 0.8,
    }));
    sign.position.set(Math.cos(doorAng) * 6.8, 3.55, Math.sin(doorAng) * 6.8);
    sign.lookAt(0, 3.55, 0);
    s.add(sign);

    // стеллажи с ящиками и бочки
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x6b5233, roughness: 0.85 });
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x3d4a33, roughness: 0.8 });
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0x3a3b3d, metalness: 0.7, roughness: 0.5 });
    [0.5, 1.4, 2.3, -0.6, -1.5].forEach((a, idx) => {
      const g = new THREE.Group();
      for (let k = 0; k < 3; k++) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.6), shelfMat);
        plank.position.y = 0.3 + k * 0.85; g.add(plank);
        for (let j = 0; j < 3; j++) {
          if (Math.random() < 0.25) continue;
          const sz = 0.3 + Math.random() * 0.25;
          const c = new THREE.Mesh(new THREE.BoxGeometry(sz, sz, sz), Math.random() < 0.5 ? crateMat : boxMat);
          c.position.set(-0.55 + j * 0.55, 0.33 + k * 0.85 + sz / 2, 0);
          c.rotation.y = Math.random() * 0.3; c.castShadow = true; g.add(c);
        }
      }
      [-0.88, 0.88].forEach((x) => { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.3, 0.6), shelfMat); leg.position.set(x, 1.15, 0); g.add(leg); });
      g.position.set(Math.cos(a) * 6.6, 0, Math.sin(a) * 6.6);
      g.lookAt(0, 0, 0);
      if (idx % 2) g.rotateY(0.05);
      s.add(g);
    });
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x2f5a3a, metalness: 0.4, roughness: 0.55 });
    [2.9, 3.05, 3.4, -2.6].forEach((a, i) => {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.95, 20), i === 2 ? new THREE.MeshStandardMaterial({ color: 0x8a2b1e, metalness: 0.4, roughness: 0.6 }) : barrelMat);
      b.position.set(Math.cos(a) * 6.3, 0.48, Math.sin(a) * 6.3); b.castShadow = true; s.add(b);
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
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 6;
      for (let i = 0; i < w; i += 170) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); }
    });
    const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(TABLE_R, TABLE_R, 0.09, 64), new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.65 }));
    tableTop.position.y = 0.78; tableTop.castShadow = true; tableTop.receiveShadow = true; s.add(tableTop);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(TABLE_R, 0.045, 8, 80), new THREE.MeshStandardMaterial({ color: 0x2b1c11, roughness: 0.6 }));
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.78; s.add(rim);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.45, 0.74, 20), new THREE.MeshStandardMaterial({ color: 0x232323, metalness: 0.6, roughness: 0.5 }));
    leg.position.y = 0.37; s.add(leg);

    // радио в центре стола
    const radio = new THREE.Group();
    const rb = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.24), new THREE.MeshStandardMaterial({ color: 0x3b4a3a, roughness: 0.6, metalness: 0.3 }));
    rb.position.y = 0.14; rb.castShadow = true; radio.add(rb);
    const grill = new THREE.Mesh(new THREE.CircleGeometry(0.09, 20), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    grill.position.set(-0.12, 0.14, 0.121); radio.add(grill);
    this.radioLamp = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 10), new THREE.MeshStandardMaterial({ color: 0x55ff66, emissive: 0x22ff44, emissiveIntensity: 2 }));
    this.radioLamp.position.set(0.14, 0.2, 0.122); radio.add(this.radioLamp);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.6, 6), new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 1 }));
    ant.position.set(0.18, 0.55, 0); ant.rotation.z = -0.3; radio.add(ant);
    radio.position.y = 0.825; radio.rotation.y = 0.6; s.add(radio);
    this.radio = radio;

    // лампа над столом
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.1, 6), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    cord.position.y = 3.85; s.add(cord);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.32, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x2e4a3a, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide }));
    shade.position.y = 3.2; s.add(shade);
    this.bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 16), new THREE.MeshStandardMaterial({ color: 0xfff0c8, emissive: 0xffd28a, emissiveIntensity: 3 }));
    this.bulb.position.y = 3.06; s.add(this.bulb);
    this.lamp = new THREE.SpotLight(0xffd59a, 55, 14, Math.PI / 2.6, 0.55, 1.6);
    this.lamp.position.set(0, 3.05, 0);
    this.lamp.target.position.set(0, 0, 0);
    this.lamp.castShadow = true;
    this.lamp.shadow.mapSize.set(1024, 1024);
    this.lamp.shadow.bias = -0.0005;
    s.add(this.lamp, this.lamp.target);
    this.fill = new THREE.PointLight(0xffc98a, 4, 9, 1.8);
    this.fill.position.set(0, 2.9, 0); s.add(this.fill);

    // красные аварийные лампы
    this.redLights = [];
    [Math.PI * 0.5, Math.PI * 1.5, Math.PI].forEach((a) => {
      const pos = new THREE.Vector3(Math.cos(a) * 6.9, 3.4, Math.sin(a) * 6.9);
      if (a === Math.PI) pos.y = 3.95;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 12), new THREE.MeshStandardMaterial({ color: 0xff2a1a, emissive: 0xff2010, emissiveIntensity: 2 }));
      bulb.position.copy(pos); s.add(bulb);
      const l = new THREE.PointLight(0xff2a14, 3, 7, 2);
      l.position.copy(pos).multiplyScalar(0.95); s.add(l);
      this.redLights.push({ l, bulb });
    });

    // луч на того, кто говорит
    this.speakerLight = new THREE.SpotLight(0xffe2a8, 0, 6, 0.32, 0.6, 1);
    this.speakerLight.position.set(0, 4.2, 0);
    s.add(this.speakerLight, this.speakerLight.target);
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
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.58), chairMat);
    seat.position.set(0, 0.5, -0.05); seat.castShadow = true; g.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.7, 0.06), chairMat);
    back.position.set(0, 0.86, -0.33); back.castShadow = true; g.add(back);
    for (const [x, z] of [[-0.27, 0.2], [0.27, 0.2], [-0.27, -0.3], [0.27, -0.3]]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), chairMat);
      l.position.set(x, 0.25, z); g.add(l);
    }

    const body = new THREE.Group();
    g.add(body);
    const clothes = new THREE.MeshStandardMaterial({ color, roughness: 0.75 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.42, 6, 16), clothes);
    torso.position.y = 0.98; torso.scale.set(1, 1, 0.75); torso.castShadow = true; body.add(torso);
    const legsMat = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.8 });
    for (const x of [-0.12, 0.12]) {
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.32, 4, 10), legsMat);
      thigh.rotation.x = Math.PI / 2; thigh.position.set(x, 0.6, 0.12); body.add(thigh);
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.36, 4, 10), legsMat);
      shin.position.set(x, 0.32, 0.3); body.add(shin);
    }

    const skin = new THREE.MeshStandardMaterial({ color: 0xe6c6a6, roughness: 0.6 });
    const head = new THREE.Group();
    head.position.y = HEAD_Y;
    head.rotation.order = 'YXZ';
    body.add(head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 18), skin);
    skull.castShadow = true; head.add(skull);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.205, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.4), clothes);
    cap.rotation.x = -0.25; head.add(cap);
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const black = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2 });
    for (const x of [-0.07, 0.07]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), white);
      eye.position.set(x, 0.03, 0.17); head.add(eye);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), black);
      pupil.position.set(x, 0.03, 0.212); head.add(pupil);
    }
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), skin);
    nose.position.set(0, -0.03, 0.2); head.add(nose);
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.01, 6, 16, Math.PI), black);
    mouth.position.set(0, -0.09, 0.18); mouth.rotation.z = Math.PI; head.add(mouth);

    const arms = {};
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? 1 : -1; // L — левая рука персонажа (его левая сторона = +X в его системе при взгляде вперёд по +Z)
      const pivot = new THREE.Group();
      pivot.position.set(0.31 * sx, 1.2, 0);
      pivot.rotation.order = 'YXZ';
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.38, 4, 10), clothes);
      arm.position.y = -0.24; arm.castShadow = true; pivot.add(arm);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), skin);
      hand.position.y = -0.5; pivot.add(hand);
      pivot.rotation.x = -0.75; // руки на столе
      body.add(pivot);
      arms[side] = pivot;
    }

    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(p.name, p.color), depthWrite: false, transparent: true }));
    label.scale.set(1.1, 0.275, 1); label.position.y = 1.98; g.add(label);

    const emoji = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture('👍'), transparent: true, depthWrite: false, opacity: 0 }));
    emoji.scale.set(0.42, 0.42, 1); emoji.position.y = 2.3; g.add(emoji);

    const out = new THREE.Sprite(new THREE.SpriteMaterial({
      map: canvasTex(512, 128, (ctx, w, h) => {
        ctx.fillStyle = 'rgba(140,20,10,0.85)'; ctx.beginPath(); ctx.roundRect(40, 14, w - 80, h - 28, 20); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = '700 64px "Russo One", Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('ВЫГНАН', w / 2, h / 2 + 4);
      }), transparent: true, depthWrite: false,
    }));
    out.scale.set(0.9, 0.225, 1); out.position.y = 1.1; out.visible = false; g.add(out);

    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; g.add(ring);

    // карточки на столе
    const cards = [];
    for (let i = 0; i < 8; i++) {
      const c = document.createElement('canvas');
      c.width = 512; c.height = 340;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide }));
      m.castShadow = true;
      cards.push({ mesh: m, canvas: c, tex, key: null });
      this.scene.add(m);
    }

    return { group: g, body, head, arms, label, emoji, out, ring, cards, clothes, yaw: 0, pitch: 0, ty: 0, tp: 0, gesture: null, exiled: false, seat: 0, angle: 0 };
  }

  placeCards(av, i, n) {
    // 8 карточек «домиком» перед игроком, лицом к центру стола
    const { a } = this.seatPos(i, n);
    const span = Math.min(0.9, (Math.PI * 2) / n * 0.8);
    av.cards.forEach((c, k) => {
      const row = k < 4 ? 0 : 1;
      const col = k % 4;
      const r = row === 0 ? 1.66 : 1.38;
      const ang = a + (col - 1.5) * (span / 4) * (row === 0 ? 1 : 1.12);
      const y = row === 0 ? 1.0 : 0.935;
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
      // карточки
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
    const av = this.avatars.get(id);
    if (!av || !GESTURE_EMOJI[g]) return;
    av.gesture = { g, t0: performance.now() };
    av.emoji.material.map = emojiTexture(GESTURE_EMOJI[g]);
    av.emoji.material.needsUpdate = true;
  }

  // ---------- камера и управление ----------
  myAvatar() { return this.myId ? this.avatars.get(this.myId) : null; }

  applyCamera() {
    const av = this.myAvatar();
    if (!av) {
      this.camera.position.set(0, 3.2, 5.6);
      this.camera.rotation.set(-0.45 + this.pitch * 0.3, this.yaw * 0.5, 0);
      return;
    }
    const a = av.angle;
    const facing = Math.atan2(Math.cos(a), Math.sin(a));
    if (av.exiled) {
      // выгнанный смотрит сверху из вентиляции
      this.camera.position.set(Math.cos(a) * 5.4, 3.7, Math.sin(a) * 5.4);
      this.camera.rotation.set(-0.55 + this.pitch * 0.6, facing + this.yaw, 0);
    } else {
      this.camera.position.set(Math.cos(a) * (SEAT_R - 0.05), HEAD_Y + 0.05, Math.sin(a) * (SEAT_R - 0.05));
      this.camera.rotation.set(this.pitch, facing + this.yaw, 0);
    }
  }

  bindInput() {
    const el = this.renderer.domElement;
    el.style.touchAction = 'none';
    let drag = null;
    el.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointerup', () => { drag = null; });
    el.addEventListener('pointercancel', () => { drag = null; });
    el.addEventListener('pointermove', (e) => {
      if (document.pointerLockElement === el) return this.look(e.movementX, e.movementY);
      if (!drag) return;
      this.look(e.clientX - drag.x, e.clientY - drag.y);
      drag = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener('dblclick', () => { if (el.requestPointerLock) el.requestPointerLock(); });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.fov = Math.max(28, Math.min(80, this.fov + Math.sign(e.deltaY) * 4));
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

  // ---------- кадр ----------
  frame() {
    const t = this.clock.getElapsedTime();
    const now = performance.now();

    // мерцание лампы
    const flick = Math.random() < 0.012 ? 0.25 : 1;
    this.lamp.intensity = 55 * flick * (0.96 + Math.sin(t * 13) * 0.02);
    this.fill.intensity = 4 * flick;
    this.bulb.material.emissiveIntensity = 3 * flick;
    this.redLights.forEach((r, i) => {
      const v = 0.5 + 0.5 * Math.sin(t * 2.2 + i * 2);
      r.l.intensity = 0.8 + v * 2.6; r.bulb.material.emissiveIntensity = 0.6 + v * 2.2;
    });
    this.radioLamp.material.emissiveIntensity = 1 + Math.abs(Math.sin(t * 4));

    // луч на говорящего
    const sp = this.state && this.state.speaker && this.avatars.get(this.state.speaker);
    if (sp && this.state.phase === 'reveal') {
      this.speakerLight.intensity = 30;
      this.speakerLight.target.position.copy(sp.group.position);
      this.speakerLight.target.position.y = 1;
      this.speakerLight.target.updateMatrixWorld();
    } else this.speakerLight.intensity = 0;

    for (const [id, av] of this.avatars) {
      // плавный поворот головы
      av.yaw += (av.ty - av.yaw) * 0.18;
      av.pitch += (av.tp - av.pitch) * 0.18;
      let hy = av.yaw * 0.85, hx = -av.pitch * 0.8, bodyY = av.yaw * 0.18;
      let L = { x: -0.75, z: 0, y: 0 }, R = { x: -0.75, z: 0, y: 0 };
      let bob = Math.sin(t * 1.6 + av.seat) * 0.008;
      let emojiOp = 0;

      if (av.gesture) {
        const dt = (now - av.gesture.t0) / 1000;
        const dur = 1.8;
        if (dt > dur) av.gesture = null;
        else {
          const k = dt / dur;
          const env = Math.sin(Math.PI * Math.min(1, k * 1.15));
          emojiOp = Math.min(1, (1 - k) * 3);
          switch (av.gesture.g) {
            case 'nod': hx += Math.sin(dt * 14) * 0.35 * (1 - k); break;
            case 'shake': hy += Math.sin(dt * 16) * 0.45 * (1 - k); break;
            case 'shrug':
              L = { x: -0.6 * env, z: 1.1 * env, y: 0 }; R = { x: -0.6 * env, z: -1.1 * env, y: 0 };
              hx += 0.1 * env; bob += 0.05 * env; break;
            case 'point': R = { x: -1.55 * env - 0.75 * (1 - env), z: 0.15, y: av.yaw * env }; break;
            case 'raise': R = { x: -3.0 * env - 0.75 * (1 - env), z: -0.2 * env, y: 0 }; break;
            case 'facepalm': R = { x: -2.5 * env - 0.75 * (1 - env), z: 0.55 * env, y: 0 }; hx += 0.3 * env; break;
            case 'laugh': hx -= 0.35 * env; bob += Math.abs(Math.sin(dt * 18)) * 0.05 * env; break;
            case 'think': R = { x: -2.2 * env - 0.75 * (1 - env), z: 0.35 * env, y: 0 }; hy += 0.25 * env; break;
          }
        }
      }
      av.head.rotation.set(hx, hy, 0);
      av.body.rotation.y = bodyY;
      av.body.position.y = bob;
      av.arms.L.rotation.set(L.x, L.y, L.z);
      av.arms.R.rotation.set(R.x, R.y, R.z);
      av.emoji.material.opacity = id === this.myId ? 0 : emojiOp;
      av.emoji.position.y = 2.3 + (1 - emojiOp) * 0.15;

      const speaking = this.state && this.state.speaker === id && this.state.phase === 'reveal';
      av.ring.scale.setScalar(speaking ? 1.15 + Math.sin(t * 5) * 0.08 : 1);
    }

    this.renderer.render(this.scene, this.camera);
  }
}
