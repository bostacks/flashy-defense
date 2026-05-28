import * as THREE from 'three';

// =============================================================
// Flashy Defense — Tower-Defense/RPG mashup in a 10yo's bedroom
// =============================================================

// ---------- Constants ----------
const ROOM = { w: 32, d: 32, h: 14 };
const ORB_POSITION = new THREE.Vector3(11, 4.5, -11);
const FLASHY_SPEED = 9;
const PROJECTILE_SPEED = 34;
const CAMERA_OFFSET = new THREE.Vector3(0, 22, 17);

const SPAWN_POINTS = [
  new THREE.Vector3(-12, 0, 14),
  new THREE.Vector3(0, 0, 15),
  new THREE.Vector3(12, 0, 14),
  new THREE.Vector3(14, 0, 4),
];

// Axis-aligned obstacle rectangles (xz plane) that Flashy can't walk through.
const OBSTACLES = [
  { x: -10, z: -10, w: 11,  d: 7.5 },  // bed
  { x:  11, z: -11, w: 4.5, d: 4   },  // nightstand (carries the orb)
  { x:  10, z:  11, w: 6,   d: 3.5 },  // toy chest
  { x: -13, z:   9, w: 5.5, d: 3.2 },  // dresser
];

function resolveObstacleCollision(pos, radius = 0.8) {
  for (const o of OBSTACLES) {
    const halfW = o.w / 2 + radius;
    const halfD = o.d / 2 + radius;
    const dx = pos.x - o.x;
    const dz = pos.z - o.z;
    if (Math.abs(dx) < halfW && Math.abs(dz) < halfD) {
      // Inside the expanded AABB — push out along the shallowest axis
      const overlapX = halfW - Math.abs(dx);
      const overlapZ = halfD - Math.abs(dz);
      if (overlapX < overlapZ) pos.x = o.x + Math.sign(dx || 1) * halfW;
      else                     pos.z = o.z + Math.sign(dz || 1) * halfD;
    }
  }
}

// ---------- Audio (Web Audio, no external assets) ----------
const audio = (() => {
  let ctx = null, masterGain = null, musicGain = null, sfxGain = null;
  let muted = false, musicTimer = null;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      masterGain = ctx.createGain(); masterGain.gain.value = 0.55; masterGain.connect(ctx.destination);
      musicGain  = ctx.createGain(); musicGain.gain.value  = 0.35; musicGain.connect(masterGain);
      sfxGain    = ctx.createGain(); sfxGain.gain.value    = 0.9;  sfxGain.connect(masterGain);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  function tone(freq, dur, opts = {}) {
    if (muted || !ensure()) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (opts.freqEnd) osc.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + dur);
    const vol = opts.volume ?? 0.25;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.01, dur * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(sfxGain);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  function noise(dur, opts = {}) {
    if (muted || !ensure()) return;
    const t = ctx.currentTime;
    const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.7;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(opts.volume ?? 0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const filt = ctx.createBiquadFilter();
    filt.type = opts.filterType || 'lowpass';
    filt.frequency.value = opts.filterFreq || 1500;
    src.connect(filt).connect(gain).connect(sfxGain);
    src.start(t);
  }

  // SFX
  function shoot()  { tone(880, 0.06, { type:'square',   freqEnd: 320, volume: 0.18 }); }
  function hit()    { tone(220, 0.08, { type:'triangle', freqEnd: 80,  volume: 0.22 }); }
  function kill()   { tone(440, 0.18, { type:'triangle', freqEnd: 80,  volume: 0.18 });
                      noise(0.16, { volume: 0.12, filterFreq: 600 }); }
  function pickup() { tone(880, 0.08, { volume: 0.22 });
                      setTimeout(() => tone(1320, 0.12, { volume: 0.22 }), 70); }
  function place()  { tone(330, 0.08, { type:'square',   freqEnd: 150, volume: 0.2 }); }
  function fart()   {
    // Long, loud, sputtering — intentionally louder than other SFX
    noise(2.2, { volume: 0.95, filterFreq: 420 });
    tone(80, 2.0, { type:'sawtooth', freqEnd: 50, volume: 0.7 });
    setTimeout(() => { tone(140, 0.5, { type:'sawtooth', freqEnd: 75, volume: 0.65 }); noise(0.35, { volume: 0.55, filterFreq: 500 }); }, 350);
    setTimeout(() => { tone(95,  0.6, { type:'sawtooth', freqEnd: 55, volume: 0.6 });  noise(0.5,  { volume: 0.5,  filterFreq: 450 }); }, 850);
    setTimeout(() => { tone(120, 0.4, { type:'sawtooth', freqEnd: 70, volume: 0.55 }); noise(0.3,  { volume: 0.45, filterFreq: 480 }); }, 1450);
    setTimeout(() => { tone(90,  0.45,{ type:'sawtooth', freqEnd: 50, volume: 0.5 });  noise(0.35, { volume: 0.4,  filterFreq: 420 }); }, 1900);
  }
  function orbHit() { tone(150, 0.5, { type:'sawtooth', freqEnd: 50, volume: 0.3 }); }
  function wave()   { tone(440, 0.14, { type:'triangle', volume: 0.25 });
                      setTimeout(() => tone(660, 0.18, { type:'triangle', volume: 0.25 }), 130);
                      setTimeout(() => tone(880, 0.25, { type:'triangle', volume: 0.25 }), 270); }
  function over()   { tone(330, 0.3, { type:'sawtooth', freqEnd: 100, volume: 0.3 });
                      setTimeout(() => tone(220, 0.5, { type:'sawtooth', freqEnd: 50, volume: 0.3 }), 220); }
  function jump()   { tone(440, 0.12, { type:'sine', freqEnd: 880, volume: 0.15 }); }

  // Music — action-style chiptune loop in C major (I-vi-IV-V), 150 BPM
  const N = {
    C2:65.41, D2:73.42, E2:82.41, F2:87.31, G2:98, A2:110, B2:123.47,
    C3:130.81, D3:146.83, E3:164.81, F3:174.61, G3:196, A3:220, B3:246.94,
    C4:261.63, D4:293.66, E4:329.63, F4:349.23, G4:392, A4:440, B4:493.88,
    C5:523.25, D5:587.33, E5:659.25, F5:698.46, G5:783.99, A5:880,
  };
  const BEAT = 0.4;             // 150 BPM
  const EIGHTH = BEAT / 2;
  const LOOP_LEN = 16 * BEAT;   // 6.4s loop

  // Catchy hook (32 eighth notes across 4 bars)
  const MELODY = [
    'E4','G4','C5','E5','G5','E5','C5','G4',   // C
    'A4','C5','E5','A5','E5','C5','A4','E4',   // Am
    'F4','A4','C5','F5','C5','A4','F4','C4',   // F
    'G4','B4','D5','G5','D5','B4','G4','D4',   // G
  ];
  // Driving bass (root/fifth, quarter notes — 16 total)
  const BASS = [
    'C3','G3','C3','G3',
    'A3','E3','A3','E3',
    'F3','C3','F3','C3',
    'G3','D3','G3','D3',
  ];

  function playNote(freq, when, dur, type, vol) {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(vol, when + 0.02);
    gain.gain.setValueAtTime(vol, when + Math.max(0.04, dur - 0.08));
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(gain).connect(musicGain);
    osc.start(when); osc.stop(when + dur + 0.05);
  }
  function playKick(when) {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, when);
    osc.frequency.exponentialRampToValueAtTime(45, when + 0.09);
    gain.gain.setValueAtTime(0.32, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.18);
    osc.connect(gain).connect(musicGain);
    osc.start(when); osc.stop(when + 0.22);
  }
  function playSnare(when) {
    const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * 0.12)), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.6;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.13, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.11);
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass'; filt.frequency.value = 2200; filt.Q.value = 1.2;
    src.connect(filt).connect(gain).connect(musicGain);
    src.start(when); src.stop(when + 0.14);
  }
  function playHihat(when, vol = 0.05) {
    const len = 0.04;
    const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * len)), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + len);
    const filt = ctx.createBiquadFilter();
    filt.type = 'highpass'; filt.frequency.value = 6000;
    src.connect(filt).connect(gain).connect(musicGain);
    src.start(when); src.stop(when + len + 0.02);
  }

  function scheduleLoop() {
    if (!ctx) return;
    if (!muted) {
      const t0 = ctx.currentTime;
      // Melody (square wave for chiptune feel)
      for (let i = 0; i < MELODY.length; i++) {
        const f = N[MELODY[i]];
        if (f) playNote(f, t0 + i * EIGHTH, EIGHTH * 0.85, 'square', 0.085);
      }
      // Bass (triangle, fat)
      for (let i = 0; i < BASS.length; i++) {
        const f = N[BASS[i]];
        if (f) playNote(f, t0 + i * BEAT, BEAT * 0.9, 'triangle', 0.18);
      }
      // Drums
      for (let b = 0; b < 16; b++) {
        playKick(t0 + b * BEAT);
        if (b % 4 === 1 || b % 4 === 3) playSnare(t0 + b * BEAT);
      }
      for (let e = 0; e < 32; e++) {
        playHihat(t0 + e * EIGHTH, e % 2 === 0 ? 0.035 : 0.06);
      }
    }
    musicTimer = setTimeout(scheduleLoop, Math.max(50, LOOP_LEN * 1000 - 80));
  }

  function startMusic() { if (!ensure() || musicTimer) return; scheduleLoop(); }
  function stopMusic()  { if (musicTimer) clearTimeout(musicTimer); musicTimer = null; }
  function toggleMute() {
    muted = !muted;
    if (masterGain) masterGain.gain.setValueAtTime(muted ? 0 : 0.55, ctx.currentTime);
    return muted;
  }
  function isMuted() { return muted; }

  return { ensure, startMusic, stopMusic, toggleMute, isMuted,
           shoot, hit, kill, pickup, place, fart, orbHit, wave, over, jump };
})();

// ---------- Renderer / Scene ----------
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x180e36);
scene.fog = new THREE.Fog(0x180e36, 30, 70);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.copy(CAMERA_OFFSET);
camera.lookAt(0, 0, 0);

// ---------- Lights ----------
scene.add(new THREE.AmbientLight(0x6a6494, 0.55));

const moonLight = new THREE.DirectionalLight(0xc1d6ff, 0.5);
moonLight.position.set(-14, 22, 12);
moonLight.castShadow = true;
moonLight.shadow.mapSize.set(2048, 2048);
const s = 22;
moonLight.shadow.camera.left = -s;
moonLight.shadow.camera.right = s;
moonLight.shadow.camera.top = s;
moonLight.shadow.camera.bottom = -s;
moonLight.shadow.camera.near = 1;
moonLight.shadow.camera.far = 60;
scene.add(moonLight);

const orbLight = new THREE.PointLight(0xffd07a, 2.2, 26, 1.4);
orbLight.position.copy(ORB_POSITION);
orbLight.castShadow = false;
scene.add(orbLight);

// ---------- Helpers ----------
function makeMat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.85,
    metalness: opts.metalness ?? 0.04,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
  });
}
function box(w, h, d, color, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), makeMat(color, opts));
  m.castShadow = opts.castShadow ?? true;
  m.receiveShadow = opts.receiveShadow ?? true;
  return m;
}
function ball(r, color, opts = {}) {
  const segs = opts.segments ?? 18;
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, segs, Math.max(8, Math.floor(segs * 0.7))), makeMat(color, opts));
  m.castShadow = opts.castShadow ?? true;
  m.receiveShadow = opts.receiveShadow ?? false;
  return m;
}

// ---------- Build the room ----------
function buildRoom() {
  // Floor (wood)
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.w, ROOM.d),
    makeMat(0xcfa17a, { roughness: 0.95 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Round purple rug accent
  const rug = new THREE.Mesh(
    new THREE.CircleGeometry(8.5, 36),
    makeMat(0x6a4aa3, { roughness: 0.95 })
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.y = 0.012;
  rug.receiveShadow = true;
  scene.add(rug);

  // Walls (back / left)
  const wallMat = makeMat(0xa8d4ec, { roughness: 0.95 });
  const wallBack = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.h), wallMat);
  wallBack.position.set(0, ROOM.h / 2, -ROOM.d / 2);
  wallBack.receiveShadow = true;
  scene.add(wallBack);
  const wallLeft = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.d, ROOM.h), wallMat);
  wallLeft.position.set(-ROOM.w / 2, ROOM.h / 2, 0);
  wallLeft.rotation.y = Math.PI / 2;
  wallLeft.receiveShadow = true;
  scene.add(wallLeft);

  // Window on back wall with stars
  const window1 = box(7, 5, 0.2, 0x0a1838, { emissive: 0x0a1838, roughness: 0.5 });
  window1.position.set(-3, 8, -ROOM.d / 2 + 0.11);
  scene.add(window1);
  const frame = box(7.5, 5.5, 0.4, 0xeeeeee);
  frame.position.set(-3, 8, -ROOM.d / 2 + 0.05);
  scene.add(frame);
  // Stars
  for (let i = 0; i < 18; i++) {
    const star = ball(0.07, 0xffffff, { emissive: 0xffffff, emissiveIntensity: 1.2, segments: 6, castShadow: false });
    star.position.set(-3 + (Math.random() - 0.5) * 6, 8 + (Math.random() - 0.5) * 4, -ROOM.d / 2 + 0.15);
    scene.add(star);
  }

  // Door on the south wall (where Sassinator sends minions)
  const door = box(4, 7, 0.3, 0x6a3a1a);
  door.position.set(0, 3.5, ROOM.d / 2 - 0.05);
  scene.add(door);
  const doorknob = ball(0.18, 0xffe070, { emissive: 0xffd95f, emissiveIntensity: 0.4 });
  doorknob.position.set(1.4, 3.5, ROOM.d / 2 - 0.2);
  scene.add(doorknob);

  // Bed
  const bed = new THREE.Group();
  const frameBed = box(11, 1.4, 7.5, 0x7a4a26);
  frameBed.position.y = 0.7;
  bed.add(frameBed);
  const mattress = box(10.6, 1, 7.2, 0xfff4e0);
  mattress.position.y = 1.9;
  bed.add(mattress);
  const blanket = box(10.8, 0.45, 5.5, 0xff9bd0);
  blanket.position.set(0, 2.65, 0.8);
  bed.add(blanket);
  const pillow = box(4, 0.55, 2, 0xfafafa);
  pillow.position.set(0, 2.7, -2.5);
  bed.add(pillow);
  // Chelsea, asleep under the covers
  const cBody = box(3.8, 0.8, 4.2, 0xffadda);
  cBody.position.set(0, 2.85, 0.6);
  bed.add(cBody);
  // Hair (back of head, fluffy)
  const cHair = ball(0.82, 0x3a2419);
  cHair.scale.set(1.05, 0.85, 1.0);
  cHair.position.set(0, 3.35, -2.35);
  bed.add(cHair);
  // Head (skin)
  const cHead = ball(0.65, 0xf5d8b8);
  cHead.position.set(0, 3.15, -1.95);
  bed.add(cHead);
  // Pigtails / side hair tufts
  const tuftL = ball(0.32, 0x3a2419, { segments: 10 });
  tuftL.position.set(-0.72, 2.95, -1.95);
  bed.add(tuftL);
  const tuftR = tuftL.clone();
  tuftR.position.x = 0.72;
  bed.add(tuftR);
  // Bangs (small dark crescent above forehead)
  const bangs = box(0.95, 0.18, 0.2, 0x3a2419);
  bangs.position.set(0, 3.45, -1.45);
  bed.add(bangs);
  // Closed eyes (small horizontal lines on the face)
  const cEyeL = box(0.18, 0.04, 0.04, 0x2a1409);
  cEyeL.position.set(-0.22, 3.18, -1.38);
  bed.add(cEyeL);
  const cEyeR = cEyeL.clone();
  cEyeR.position.x = 0.22;
  bed.add(cEyeR);
  // Peaceful little smile
  const cMouth = box(0.22, 0.05, 0.04, 0x6a3a2a);
  cMouth.position.set(0, 2.93, -1.4);
  bed.add(cMouth);
  // Tiny rosy cheeks
  const cheekL = ball(0.12, 0xffb4c8, { segments: 8 });
  cheekL.position.set(-0.42, 3.02, -1.4);
  bed.add(cheekL);
  const cheekR = cheekL.clone();
  cheekR.position.x = 0.42;
  bed.add(cheekR);
  // Floating Zzz above her head
  const zzz = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const z = box(0.25, 0.25, 0.04, 0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.6 });
    z.position.set(0.4 + i * 0.4, i * 0.35, 0);
    z.rotation.z = -0.2;
    zzz.add(z);
  }
  zzz.position.set(0.8, 4.4, -2.0);
  bed.add(zzz);
  bed.position.set(-10, 0, -10);
  scene.add(bed);

  // Nightstand
  const nightstand = box(4.5, 4.4, 4, 0x9c6a3e);
  nightstand.position.set(11, 2.2, -11);
  scene.add(nightstand);

  // The Orb (moon nightlight)
  const orbGroup = new THREE.Group();
  const orb = ball(1.5, 0xfff0c5, {
    emissive: 0xffd07a, emissiveIntensity: 1.1, segments: 28, roughness: 0.4,
  });
  orbGroup.add(orb);
  // little crater dots
  for (let i = 0; i < 4; i++) {
    const c = ball(0.18 + Math.random() * 0.08, 0xe8c79a, { segments: 8 });
    const u = Math.random() * Math.PI * 2;
    const v = (Math.random() - 0.5) * 0.8;
    c.position.set(Math.cos(u) * 1.45 * Math.cos(v), Math.sin(v) * 1.45, Math.sin(u) * 1.45 * Math.cos(v));
    orbGroup.add(c);
  }
  orbGroup.position.copy(ORB_POSITION);
  scene.add(orbGroup);

  // Toy chest
  const chest = box(6, 3, 3.5, 0xd1683a);
  chest.position.set(10, 1.5, 11);
  scene.add(chest);
  const chestLid = box(6.1, 0.5, 3.6, 0xb04d23);
  chestLid.position.set(10, 3.15, 11);
  scene.add(chestLid);

  // Dresser
  const dresser = box(5.5, 6.5, 3.2, 0xb98a5c);
  dresser.position.set(-13, 3.25, 9);
  scene.add(dresser);
  for (let i = 0; i < 3; i++) {
    const knob = ball(0.18, 0x3a2419, { segments: 8 });
    knob.position.set(-13 + 1.6, 1.4 + i * 1.8, 9 - 1.65);
    scene.add(knob);
  }

  // A bouncy ball toy
  const toyBall = ball(0.8, 0xff5577, { roughness: 0.4 });
  toyBall.position.set(4, 0.8, 6);
  scene.add(toyBall);

  // Building blocks
  for (let i = 0; i < 5; i++) {
    const b = box(0.9, 0.9, 0.9, [0x66ddee, 0xffd25f, 0x9be36a, 0xff7eb3, 0xb38fff][i]);
    b.position.set(-5 + i * 0.95, 0.45, 8);
    scene.add(b);
  }

  return { orb: orbGroup, orbMesh: orb };
}

const roomRefs = buildRoom();

// ---------- Build Flashy (fluffy mauve-gray three-toed sloth plush) ----------
function createFlashy() {
  const g = new THREE.Group();

  // Plush palette (matches the reference plush)
  const FUR        = 0xc4b9b7;   // warm light gray
  const FUR_LIGHT  = 0xddd3d1;   // lighter highlights
  const FUR_DARK   = 0xa89e9c;   // shadow gray
  const MASK_WHITE = 0xfdf8f0;   // off-white face mask
  const EYE_PATCH  = 0xa39896;   // darker warm gray patches
  const SNOUT      = 0xcfa888;   // tan snout / paw pads
  const NOSE       = 0x2e1f10;   // dark brown nose / toes
  const BLACK      = 0x111111;

  // ---- Body (smooth plain gray torso) ----
  const bodyGroup = new THREE.Group();
  bodyGroup.position.y = 1.4;
  const bodyCore = ball(1.15, FUR, { roughness: 0.95 });
  bodyCore.scale.set(1.12, 1.18, 1.0);
  bodyGroup.add(bodyCore);
  g.add(bodyGroup);

  // ---- Head (smooth plain gray) ----
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 2.7, 0);
  const headCore = ball(1.0, FUR, { roughness: 0.95 });
  headCore.scale.set(1.08, 1.0, 0.95);
  headGroup.add(headCore);
  g.add(headGroup);

  // ---- White face mask (figure-8 shape over the eyes + snout area) ----
  const maskL = ball(0.42, MASK_WHITE, { segments: 16, roughness: 0.7, castShadow: false });
  maskL.scale.set(1.0, 1.15, 0.4);
  maskL.position.set(-0.27, 2.78, 0.78);
  g.add(maskL);
  const maskR = maskL.clone();
  maskR.position.x = 0.27;
  g.add(maskR);
  const maskBot = ball(0.42, MASK_WHITE, { segments: 16, roughness: 0.7, castShadow: false });
  maskBot.scale.set(1.3, 0.85, 0.45);
  maskBot.position.set(0, 2.46, 0.83);
  g.add(maskBot);

  // ---- Gray eye patches (tilted ovals — classic sloth markings) ----
  const patchL = ball(0.27, EYE_PATCH, { segments: 14, castShadow: false });
  patchL.scale.set(1.0, 0.62, 0.3);
  patchL.position.set(-0.33, 2.8, 0.97);
  patchL.rotation.z = -0.22;
  g.add(patchL);
  const patchR = patchL.clone();
  patchR.position.x = 0.33;
  patchR.rotation.z = 0.22;
  g.add(patchR);

  // ---- Eyes (small black dots in the patches) ----
  const eyeL = ball(0.082, BLACK, { segments: 10 });
  eyeL.position.set(-0.33, 2.8, 1.07);
  g.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.33;
  g.add(eyeR);
  // Sparkle highlights
  const sparkleL = ball(0.022, 0xffffff, { segments: 6, emissive: 0xffffff, emissiveIntensity: 1, castShadow: false });
  sparkleL.position.set(-0.31, 2.82, 1.12);
  g.add(sparkleL);
  const sparkleR = sparkleL.clone();
  sparkleR.position.set(0.35, 2.82, 1.12);
  g.add(sparkleR);

  // ---- Snout (tan puffy oval) ----
  const snout = ball(0.24, SNOUT, { segments: 14, roughness: 0.7 });
  snout.scale.set(1.35, 0.9, 0.65);
  snout.position.set(0, 2.49, 1.04);
  g.add(snout);
  // Nose (small dark bump on top of snout)
  const nose = ball(0.085, NOSE, { segments: 8 });
  nose.scale.set(1.3, 0.9, 1);
  nose.position.set(0, 2.56, 1.18);
  g.add(nose);
  // Embroidered smile
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(0.1, 0.022, 8, 16, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x4a3a2a })
  );
  smile.position.set(0, 2.36, 1.13);
  smile.rotation.set(Math.PI, 0, 0);
  g.add(smile);

  // ---- Arms (plain gray, hang down in front of body) ----
  function makeArm() {
    const armG = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.27, 0.3, 2.1, 12),
      makeMat(FUR, { roughness: 0.95 })
    );
    core.castShadow = true;
    armG.add(core);
    return armG;
  }
  const armL = makeArm();
  armL.position.set(-0.8, 1.35, 0.35);
  armL.rotation.z = 0.18;
  g.add(armL);
  const armR = makeArm();
  armR.position.set(0.8, 1.35, 0.35);
  armR.rotation.z = -0.18;
  g.add(armR);

  // ---- Hands (plain gray paws) ----
  function makeHand() {
    const hG = new THREE.Group();
    hG.add(ball(0.32, FUR, { segments: 10 }));
    return hG;
  }
  const handL = makeHand();
  handL.position.set(-0.8, 0.3, 0.35);
  g.add(handL);
  const handR = makeHand();
  handR.position.set(0.8, 0.3, 0.35);
  g.add(handR);

  // ---- Feet (round, plain gray) ----
  function makeFoot() {
    const fG = new THREE.Group();
    const core = ball(0.42, FUR, { segments: 12 });
    core.scale.set(1.05, 0.7, 1.45);
    fG.add(core);
    return fG;
  }
  const footL = makeFoot();
  footL.position.set(-0.45, 0.32, 0.45);
  g.add(footL);
  const footR = makeFoot();
  footR.position.set(0.45, 0.32, 0.45);
  g.add(footR);
  // Tan paw pads on top-front of each foot
  const padL = ball(0.19, SNOUT, { segments: 10, castShadow: false });
  padL.scale.set(1, 0.4, 1.1);
  padL.position.set(-0.45, 0.42, 0.95);
  g.add(padL);
  const padR = padL.clone();
  padR.position.x = 0.45;
  g.add(padR);
  // Three dark toe bumps per foot
  for (const sx of [-0.45, 0.45]) {
    for (let t = -1; t <= 1; t++) {
      const toe = ball(0.05, NOSE, { segments: 6 });
      toe.position.set(sx + t * 0.12, 0.22, 1.05);
      g.add(toe);
    }
  }

  // ---- Plush hang-tag ----
  const tag = box(0.16, 0.2, 0.02, 0xffffff);
  tag.position.set(1.0, 1.85, 0.2);
  tag.rotation.z = 0.3;
  g.add(tag);

  g.userData = {
    hp: 100, maxHp: 100, speed: FLASHY_SPEED,
    fireCooldown: 0, vy: 0, jumping: false,
    lastShotAt: 0,
    body: bodyGroup, armL, armR, handL, handR, footL, footR, padL, padR,
    walkPhase: 0,
    // Rest positions used by the walk-cycle animation
    rest: { bodyY: 1.4, footY: 0.32, padY: 0.42, armZ: 0.35, handZ: 0.30 },
  };
  g.position.set(0, 0, 4);
  return g;
}

const flashy = createFlashy();
scene.add(flashy);

// Aiming reticle
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.4, 0.55, 24),
  new THREE.MeshBasicMaterial({ color: 0xff7eb3, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
);
reticle.rotation.x = -Math.PI / 2;
reticle.position.y = 0.04;
scene.add(reticle);

// Turret placement ghost
const ghost = new THREE.Mesh(
  new THREE.CylinderGeometry(0.9, 1.0, 1.2, 14),
  new THREE.MeshBasicMaterial({ color: 0x66ddee, transparent: true, opacity: 0.35 })
);
ghost.visible = false;
scene.add(ghost);

// ---------- Game state ----------
const state = {
  running: false,
  wave: 0,
  inIntermission: true,
  intermissionTime: 3.5,
  sparkles: 40,
  ammo: 100,
  maxAmmo: 100,
  orbLives: 3,
  enemiesToSpawn: 0,
  spawnTimer: 0,
  spawnInterval: 1.5,
  currentTypes: ['minion'],
  currentReward: 30,
  fartTimer: 8,
  enemies: [],
  projectiles: [],
  turrets: [],
  pickups: [],
  particles: [],
  weapons: {
    dart: { unlocked: true, damage: 12, cooldown: 0.22 },
    bubble: { unlocked: false },
    marshmallow: { unlocked: false },
    missile: { unlocked: false },
  },
  turretType: 'dart',
  placingTurret: false,
  tempBuffs: [],
  tripleShot: false,
  camYaw: Math.PI,
  camPitch: -0.15,
  // High-score tracking
  playerName: '',
  kills: 0,
  totalSparklesEarned: 0,
};

// ---------- Levels (re-tuned: more enemies, faster spawns, tougher mix) ----------
const LEVELS = [
  { count:  8, spawnInterval: 1.40, types: ['minion'],                                       reward: 30 },
  { count: 14, spawnInterval: 1.10, types: ['minion'],                                       reward: 45, unlock: 'bubble' },
  { count: 20, spawnInterval: 0.90, types: ['minion', 'para', 'skyler'],                     reward: 60, unlock: 'missile' },
  { count: 28, spawnInterval: 0.75, types: ['minion', 'skyler', 'honey', 'para'],            reward: 80, unlock: 'marshmallow' },
  { count: 36, spawnInterval: 0.65, types: ['minion', 'skyler', 'honey', 'para'],            reward: 110 },
  { count: 44, spawnInterval: 0.55, types: ['minion', 'skyler', 'honey', 'para', 'sassinator'], reward: 160 },
  { count: 54, spawnInterval: 0.50, types: ['minion', 'skyler', 'honey', 'para', 'sassinator'], reward: 220 },
  { count: 66, spawnInterval: 0.45, types: ['skyler', 'honey', 'para', 'sassinator'],        reward: 300 },
];

// ---------- Stuffed-animal species builders ----------
function addAngryBrows(g, size, x = 0.22, y = 1.7, z = 0.5) {
  const browL = box(size * 0.2, size * 0.06, size * 0.06, 0x111111);
  browL.position.set(-size * x, size * y, size * z);
  browL.rotation.z = -0.5;
  g.add(browL);
  const browR = browL.clone();
  browR.position.x = size * x;
  browR.rotation.z = 0.5;
  g.add(browR);
}

function makeBear(size, color) {
  const g = new THREE.Group();
  const body = ball(size * 0.8, color);
  body.scale.set(1, 1, 0.95);
  body.position.y = size * 0.7;
  g.add(body);
  const belly = ball(size * 0.5, 0xfff1d6, { segments: 12 });
  belly.scale.set(1, 1.1, 0.55);
  belly.position.set(0, size * 0.55, size * 0.5);
  g.add(belly);
  const head = ball(size * 0.55, color);
  head.position.set(0, size * 1.5, size * 0.05);
  g.add(head);
  const snout = ball(size * 0.22, 0xfff1d6, { segments: 10 });
  snout.scale.set(1, 0.85, 1);
  snout.position.set(0, size * 1.4, size * 0.5);
  g.add(snout);
  const nose = ball(size * 0.07, 0x222222, { segments: 8 });
  nose.position.set(0, size * 1.46, size * 0.65);
  g.add(nose);
  const earL = ball(size * 0.2, color, { segments: 10 });
  earL.position.set(-size * 0.4, size * 1.9, 0);
  g.add(earL);
  const earR = earL.clone();
  earR.position.x = size * 0.4;
  g.add(earR);
  const innerL = ball(size * 0.11, 0xffd0a8, { segments: 8 });
  innerL.position.set(-size * 0.4, size * 1.9, size * 0.06);
  g.add(innerL);
  const innerR = innerL.clone();
  innerR.position.x = size * 0.4;
  g.add(innerR);
  const eyeL = ball(0.1 * size, 0x111111, { segments: 8 });
  eyeL.position.set(-size * 0.22, size * 1.58, size * 0.47);
  g.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.x = size * 0.22;
  g.add(eyeR);
  addAngryBrows(g, size, 0.22, 1.72, 0.47);
  const legL = box(size * 0.3, size * 0.3, size * 0.3, color);
  legL.position.set(-size * 0.35, size * 0.15, size * 0.1);
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = size * 0.35;
  g.add(legR);
  return g;
}

function makeBunny(size, color) {
  const g = new THREE.Group();
  const body = ball(size * 0.7, color);
  body.scale.set(1, 1.2, 1);
  body.position.y = size * 0.7;
  g.add(body);
  const head = ball(size * 0.55, color);
  head.position.set(0, size * 1.55, 0);
  g.add(head);
  const earL = box(size * 0.16, size * 0.85, size * 0.1, color);
  earL.position.set(-size * 0.25, size * 2.2, 0);
  earL.rotation.z = -0.1;
  g.add(earL);
  const earR = earL.clone();
  earR.position.x = size * 0.25;
  earR.rotation.z = 0.1;
  g.add(earR);
  const innerL = box(size * 0.08, size * 0.7, size * 0.04, 0xffcfe2);
  innerL.position.set(-size * 0.25, size * 2.2, size * 0.05);
  innerL.rotation.z = -0.1;
  g.add(innerL);
  const innerR = innerL.clone();
  innerR.position.x = size * 0.25;
  innerR.rotation.z = 0.1;
  g.add(innerR);
  const eyeL = ball(0.1 * size, 0x111111, { segments: 8 });
  eyeL.position.set(-size * 0.2, size * 1.6, size * 0.45);
  g.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.x = size * 0.2;
  g.add(eyeR);
  const nose = ball(size * 0.07, 0xff66aa, { segments: 8 });
  nose.position.set(0, size * 1.45, size * 0.52);
  g.add(nose);
  addAngryBrows(g, size, 0.2, 1.74, 0.45);
  const tail = ball(size * 0.18, 0xffffff, { segments: 10 });
  tail.position.set(0, size * 0.7, -size * 0.7);
  g.add(tail);
  const footL = box(size * 0.25, size * 0.18, size * 0.4, color);
  footL.position.set(-size * 0.25, size * 0.1, size * 0.18);
  g.add(footL);
  const footR = footL.clone();
  footR.position.x = size * 0.25;
  g.add(footR);
  return g;
}

function makeCat(size, color) {
  const g = new THREE.Group();
  const body = ball(size * 0.7, color);
  body.scale.set(1, 1.1, 1);
  body.position.y = size * 0.7;
  g.add(body);
  const head = ball(size * 0.55, color);
  head.position.set(0, size * 1.5, 0);
  g.add(head);
  const earGeo = new THREE.ConeGeometry(size * 0.18, size * 0.4, 4);
  const earMat = makeMat(color);
  const earL = new THREE.Mesh(earGeo, earMat);
  earL.position.set(-size * 0.3, size * 2.0, 0);
  earL.rotation.y = Math.PI / 4;
  earL.castShadow = true;
  g.add(earL);
  const earR = earL.clone();
  earR.position.x = size * 0.3;
  g.add(earR);
  const eyeWL = ball(0.13 * size, 0xa3e35a, { segments: 8, emissive: 0xa3e35a, emissiveIntensity: 0.3 });
  eyeWL.position.set(-size * 0.22, size * 1.55, size * 0.45);
  g.add(eyeWL);
  const eyeWR = eyeWL.clone();
  eyeWR.position.x = size * 0.22;
  g.add(eyeWR);
  const slitL = box(size * 0.03, size * 0.11, size * 0.05, 0x111111);
  slitL.position.set(-size * 0.22, size * 1.55, size * 0.52);
  g.add(slitL);
  const slitR = slitL.clone();
  slitR.position.x = size * 0.22;
  g.add(slitR);
  const nose = ball(size * 0.07, 0xff66aa, { segments: 8 });
  nose.position.set(0, size * 1.4, size * 0.55);
  g.add(nose);
  addAngryBrows(g, size, 0.22, 1.7, 0.45);
  const whiskerMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (let i = 0; i < 6; i++) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(size * 0.35, 0.02, 0.02), whiskerMat);
    const side = i < 3 ? -1 : 1;
    w.position.set(side * size * 0.45, size * (1.4 + ((i % 3) - 1) * 0.06), size * 0.45);
    w.rotation.y = side * 0.3;
    g.add(w);
  }
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.08, size * 0.06, size * 0.7, 8), earMat);
  tail.position.set(0, size * 0.95, -size * 0.55);
  tail.rotation.x = -0.6;
  tail.castShadow = true;
  g.add(tail);
  return g;
}

function makeFrog(size, color) {
  const g = new THREE.Group();
  const body = ball(size * 0.9, color);
  body.scale.set(1, 0.6, 1);
  body.position.y = size * 0.5;
  g.add(body);
  const belly = ball(size * 0.65, 0xeaf4b8, { segments: 12 });
  belly.scale.set(1, 0.55, 0.55);
  belly.position.set(0, size * 0.4, size * 0.4);
  g.add(belly);
  const eyeL = ball(size * 0.3, 0xffffff, { segments: 12 });
  eyeL.position.set(-size * 0.32, size * 1.05, 0);
  g.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.x = size * 0.32;
  g.add(eyeR);
  const pupilL = ball(size * 0.15, 0x111111, { segments: 8 });
  pupilL.position.set(-size * 0.32, size * 1.08, size * 0.2);
  g.add(pupilL);
  const pupilR = pupilL.clone();
  pupilR.position.x = size * 0.32;
  g.add(pupilR);
  const mouth = box(size * 0.7, size * 0.06, size * 0.06, 0x222222);
  mouth.position.set(0, size * 0.55, size * 0.78);
  g.add(mouth);
  const legL = box(size * 0.3, size * 0.18, size * 0.5, color);
  legL.position.set(-size * 0.45, size * 0.12, size * 0.1);
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = size * 0.45;
  g.add(legR);
  return g;
}

function makePig(size, color) {
  const g = new THREE.Group();
  const body = ball(size * 0.75, color);
  body.scale.set(1.1, 0.95, 1.2);
  body.position.y = size * 0.65;
  g.add(body);
  const head = ball(size * 0.5, color);
  head.position.set(0, size * 0.85, size * 0.65);
  g.add(head);
  const snout = new THREE.Mesh(
    new THREE.CylinderGeometry(size * 0.22, size * 0.25, size * 0.18, 16),
    makeMat(color)
  );
  snout.rotation.x = Math.PI / 2;
  snout.position.set(0, size * 0.8, size * 1.1);
  snout.castShadow = true;
  g.add(snout);
  const nostrilL = ball(size * 0.04, 0x222222, { segments: 6 });
  nostrilL.position.set(-size * 0.09, size * 0.82, size * 1.2);
  g.add(nostrilL);
  const nostrilR = nostrilL.clone();
  nostrilR.position.x = size * 0.09;
  g.add(nostrilR);
  const earGeo = new THREE.ConeGeometry(size * 0.15, size * 0.3, 4);
  const earMat = makeMat(color);
  const earL = new THREE.Mesh(earGeo, earMat);
  earL.position.set(-size * 0.28, size * 1.25, size * 0.5);
  earL.rotation.set(0.2, Math.PI / 4, 0);
  earL.castShadow = true;
  g.add(earL);
  const earR = earL.clone();
  earR.position.x = size * 0.28;
  earR.rotation.y = -Math.PI / 4;
  g.add(earR);
  const eyeL = ball(0.07 * size, 0x111111, { segments: 6 });
  eyeL.position.set(-size * 0.2, size * 0.95, size * 1.0);
  g.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.x = size * 0.2;
  g.add(eyeR);
  const tail = new THREE.Mesh(
    new THREE.TorusGeometry(size * 0.18, size * 0.05, 8, 16, Math.PI * 1.5),
    makeMat(color)
  );
  tail.rotation.y = Math.PI / 2;
  tail.position.set(0, size * 0.7, -size * 0.7);
  tail.castShadow = true;
  g.add(tail);
  return g;
}

function makeDuck(size, color) {
  const g = new THREE.Group();
  const body = ball(size * 0.75, color);
  body.scale.set(1, 1, 1.2);
  body.position.y = size * 0.7;
  g.add(body);
  const head = ball(size * 0.5, color);
  head.position.set(0, size * 1.45, size * 0.1);
  g.add(head);
  const beak = box(size * 0.3, size * 0.14, size * 0.4, 0xff9020);
  beak.position.set(0, size * 1.35, size * 0.55);
  g.add(beak);
  const eyeL = ball(0.1 * size, 0x111111, { segments: 8 });
  eyeL.position.set(-size * 0.18, size * 1.55, size * 0.42);
  g.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.x = size * 0.18;
  g.add(eyeR);
  const wingL = box(size * 0.1, size * 0.3, size * 0.5, color);
  wingL.position.set(-size * 0.55, size * 0.7, 0);
  g.add(wingL);
  const wingR = wingL.clone();
  wingR.position.x = size * 0.55;
  g.add(wingR);
  const footL = box(size * 0.2, size * 0.05, size * 0.3, 0xff9020);
  footL.position.set(-size * 0.2, size * 0.03, size * 0.15);
  g.add(footL);
  const footR = footL.clone();
  footR.position.x = size * 0.2;
  g.add(footR);
  return g;
}

function makeDragon(size, color) {
  const g = new THREE.Group();
  const body = ball(size * 0.7, color);
  body.scale.set(1, 1, 1.3);
  body.position.y = size * 0.7;
  g.add(body);
  const head = ball(size * 0.5, color);
  head.scale.set(1, 0.9, 1.2);
  head.position.set(0, size * 1.25, size * 0.55);
  g.add(head);
  const spikeMat = makeMat(0xfff4a0);
  for (let i = 0; i < 4; i++) {
    const sp = new THREE.Mesh(new THREE.ConeGeometry(size * 0.13, size * 0.28, 4), spikeMat);
    sp.position.set(0, size * (0.95 + i * 0.05), size * (0.3 - i * 0.28));
    sp.castShadow = true;
    g.add(sp);
  }
  const eyeL = ball(0.12 * size, 0xffd255, { segments: 8, emissive: 0xffd255, emissiveIntensity: 0.45 });
  eyeL.position.set(-size * 0.2, size * 1.32, size * 0.9);
  g.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.x = size * 0.2;
  g.add(eyeR);
  const tail = new THREE.Mesh(
    new THREE.CylinderGeometry(size * 0.05, size * 0.2, size * 0.9, 8),
    makeMat(color)
  );
  tail.rotation.x = Math.PI / 2 + 0.5;
  tail.position.set(0, size * 0.6, -size * 0.7);
  tail.castShadow = true;
  g.add(tail);
  const legL = box(size * 0.25, size * 0.3, size * 0.25, color);
  legL.position.set(-size * 0.35, size * 0.15, size * 0.05);
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = size * 0.35;
  g.add(legR);
  return g;
}

function makePenguin(size, color) {
  const g = new THREE.Group();
  const body = ball(size * 0.65, color);
  body.scale.set(1, 1.35, 0.95);
  body.position.y = size * 0.85;
  g.add(body);
  const belly = ball(size * 0.5, 0xfff8e8, { segments: 12 });
  belly.scale.set(1, 1.2, 0.45);
  belly.position.set(0, size * 0.78, size * 0.42);
  g.add(belly);
  const eyeL = ball(0.1 * size, 0xffffff, { segments: 8 });
  eyeL.position.set(-size * 0.18, size * 1.5, size * 0.5);
  g.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.x = size * 0.18;
  g.add(eyeR);
  const pupilL = ball(0.04 * size, 0x111111, { segments: 6 });
  pupilL.position.set(-size * 0.18, size * 1.5, size * 0.59);
  g.add(pupilL);
  const pupilR = pupilL.clone();
  pupilR.position.x = size * 0.18;
  g.add(pupilR);
  const beak = new THREE.Mesh(
    new THREE.ConeGeometry(size * 0.12, size * 0.25, 4),
    makeMat(0xffaa33)
  );
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, size * 1.32, size * 0.65);
  beak.castShadow = true;
  g.add(beak);
  const wingL = box(size * 0.1, size * 0.6, size * 0.28, color);
  wingL.position.set(-size * 0.5, size * 0.85, 0);
  g.add(wingL);
  const wingR = wingL.clone();
  wingR.position.x = size * 0.5;
  g.add(wingR);
  const footL = box(size * 0.18, size * 0.05, size * 0.3, 0xffaa33);
  footL.position.set(-size * 0.18, size * 0.03, size * 0.15);
  g.add(footL);
  const footR = footL.clone();
  footR.position.x = size * 0.18;
  g.add(footR);
  return g;
}

function makeUnicorn(size, color) {
  const g = new THREE.Group();
  const body = ball(size * 0.85, color);
  body.scale.set(1, 1, 1.25);
  body.position.y = size * 0.85;
  g.add(body);
  const head = ball(size * 0.55, color);
  head.scale.set(1, 1.1, 1.2);
  head.position.set(0, size * 1.5, size * 0.55);
  g.add(head);
  const horn = new THREE.Mesh(
    new THREE.ConeGeometry(size * 0.1, size * 0.55, 10),
    makeMat(0xffd25f, { emissive: 0xffd25f, emissiveIntensity: 0.35 })
  );
  horn.position.set(0, size * 2.0, size * 0.5);
  horn.castShadow = true;
  g.add(horn);
  const eyeL = ball(0.13 * size, 0xff5577, { segments: 8, emissive: 0xff5577, emissiveIntensity: 0.5 });
  eyeL.position.set(-size * 0.18, size * 1.55, size * 0.95);
  g.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.x = size * 0.18;
  g.add(eyeR);
  addAngryBrows(g, size, 0.18, 1.72, 0.95);
  const mane = ball(size * 0.4, 0xb38fff);
  mane.scale.set(0.65, 1, 0.85);
  mane.position.set(0, size * 1.9, size * 0.05);
  g.add(mane);
  const tail = new THREE.Mesh(
    new THREE.CylinderGeometry(size * 0.15, size * 0.1, size * 0.7, 8),
    makeMat(0xb38fff)
  );
  tail.rotation.x = Math.PI / 2 + 0.6;
  tail.position.set(0, size * 0.7, -size * 0.8);
  tail.castShadow = true;
  g.add(tail);
  for (let i = 0; i < 4; i++) {
    const x = (i % 2 === 0 ? -1 : 1) * size * 0.3;
    const z = (i < 2 ? 1 : -1) * size * 0.4;
    const leg = box(size * 0.18, size * 0.5, size * 0.18, color);
    leg.position.set(x, size * 0.25, z);
    g.add(leg);
  }
  return g;
}

const SPECIES_BUILDERS = {
  bear: makeBear, bunny: makeBunny, cat: makeCat, frog: makeFrog,
  pig: makePig, duck: makeDuck, dragon: makeDragon, penguin: makePenguin,
};
const MINION_SPECIES = Object.keys(SPECIES_BUILDERS);
const MINION_COLORS = [
  0xa97acb, 0xff8fb5, 0x77c9e0, 0xb4d36b, 0xffd25f,
  0xd29c6b, 0xf2a8a8, 0xb38fff, 0x88e1c0, 0xff7eb3,
];

function castShadows(root) {
  root.traverse(c => { if (c.isMesh) c.castShadow = true; });
}

// Adds plush-toy touches to every stuffie: a hang-tag and a visible side seam.
function addPlushDetails(g, size) {
  // White hang-tag on the right side of the body
  const tag = box(size * 0.22, size * 0.26, size * 0.03, 0xffffff);
  tag.position.set(size * 0.72, size * 0.78, 0);
  tag.rotation.z = 0.28;
  tag.castShadow = true;
  g.add(tag);
  // Tag fold line
  const tagFold = box(size * 0.2, size * 0.025, size * 0.04, 0xdddddd);
  tagFold.position.set(size * 0.72, size * 0.91, 0);
  tagFold.rotation.z = 0.28;
  g.add(tagFold);

  // Visible side seam (a chain of tiny dark dashes down the side)
  const seamMat = new THREE.MeshBasicMaterial({ color: 0x3a2a1a });
  for (let i = 0; i < 5; i++) {
    const st = new THREE.Mesh(
      new THREE.BoxGeometry(size * 0.025, size * 0.05, size * 0.02),
      seamMat
    );
    st.position.set(-size * 0.7, size * (0.4 + i * 0.18), 0);
    g.add(st);
  }

  // Patch stitch (X) on the back lower body, so it's visible from above
  const xMat = new THREE.MeshBasicMaterial({ color: 0x2a1a0a });
  const x1 = new THREE.Mesh(new THREE.BoxGeometry(size * 0.18, size * 0.03, size * 0.02), xMat);
  x1.position.set(0, size * 0.65, -size * 0.6);
  x1.rotation.x = Math.PI / 2;
  x1.rotation.z = Math.PI / 4;
  g.add(x1);
  const x2 = x1.clone();
  x2.rotation.z = -Math.PI / 4;
  g.add(x2);
}

// ---------- Enemies ----------
function createEnemy(type, wave = 1) {
  // Per-wave scaling: enemies get faster, bigger, and much tankier each wave
  const speedMult = 1 + (wave - 1) * 0.18;
  const sizeMult  = 1 + (wave - 1) * 0.10;
  const hpMult    = 1 + (wave - 1) * 0.38;

  let hp, speed, size, color, species, g;
  switch (type) {
    case 'skyler':
      hp = 75 * hpMult; speed = 2.6 * speedMult; size = 1.25 * sizeMult;
      color = 0x6aa9ff; species = 'bunny';
      g = makeBunny(size, color);
      break;
    case 'honey':
      hp = 110 * hpMult; speed = 2.1 * speedMult; size = 1.35 * sizeMult;
      color = 0xffb84d; species = 'bear';
      g = makeBear(size, color);
      break;
    case 'sassinator':
      hp = 320 * hpMult; speed = 1.8 * speedMult; size = 1.85 * sizeMult;
      color = 0xff4d8a; species = 'unicorn';
      g = makeUnicorn(size, color);
      break;
    case 'para':
      hp = 40 * hpMult; speed = 2.5 * speedMult; size = 0.85 * sizeMult;
      species = MINION_SPECIES[Math.floor(Math.random() * MINION_SPECIES.length)];
      color = MINION_COLORS[Math.floor(Math.random() * MINION_COLORS.length)];
      g = SPECIES_BUILDERS[species](size, color);
      break;
    default:
      hp = 30 * hpMult; speed = 2.9 * speedMult; size = 0.85 * sizeMult;
      species = MINION_SPECIES[Math.floor(Math.random() * MINION_SPECIES.length)];
      color = MINION_COLORS[Math.floor(Math.random() * MINION_COLORS.length)];
      g = SPECIES_BUILDERS[species](size, color);
  }
  // Parachute stuffies start high up and fall
  const isAirborne = type === 'para';
  const paraGroup = isAirborne ? addParachute(g, size) : null;
  addPlushDetails(g, size);
  castShadows(g);

  // Health bar (billboarded as a group)
  const barGroup = new THREE.Group();
  barGroup.position.y = size * 2.4;
  const barBg = new THREE.Mesh(
    new THREE.PlaneGeometry(size * 1.6, 0.16),
    new THREE.MeshBasicMaterial({ color: 0x111111 })
  );
  barGroup.add(barBg);
  const barFg = new THREE.Mesh(
    new THREE.PlaneGeometry(size * 1.6, 0.16),
    new THREE.MeshBasicMaterial({ color: 0xff5577 })
  );
  barFg.position.z = 0.002;
  barGroup.add(barFg);
  g.add(barGroup);

  const spawn = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)].clone();
  spawn.x += (Math.random() - 0.5) * 1.5;
  spawn.z += (Math.random() - 0.5) * 1.5;
  g.position.copy(spawn);
  if (isAirborne) g.position.y = 10 + Math.random() * 4;

  // ---- Combat profile (set per type) ----
  const attackProfiles = {
    skyler:     { dps:  8, attackRange: 2.2, minWave: 3 },
    honey:      { dps: 16, attackRange: 2.6, minWave: 3 },
    sassinator: { dps: 28, attackRange: 3.2, minWave: 1 },
    para:       { dps:  6, attackRange: 2.0, minWave: 4 },
    minion:     { dps:  3, attackRange: 1.8, minWave: 5 },
  };
  const ap = attackProfiles[type] || attackProfiles.minion;
  const canAttack = wave >= ap.minWave;

  g.userData = {
    type, species, hp, maxHp: hp, speed, size, color,
    hpBar: barFg, barGroup, barWidth: size * 1.6,
    bob: Math.random() * Math.PI * 2,
    isEnemy: true,
    airborne: isAirborne, paraGroup, vy: 0,
    // Combat — start cooldown at 0.8s so first swipe has a windup,
    // giving the player time to dodge or kill the enemy first
    canAttack, dps: ap.dps, attackRange: ap.attackRange,
    attackCooldown: 0.8,
    currentTarget: null,
  };
  scene.add(g);
  state.enemies.push(g);
  return g;
}

function addParachute(g, size) {
  const paraGroup = new THREE.Group();
  // Canopy: colored hemisphere
  const colors = [0xff7eb3, 0x88c9ff, 0xffd25f, 0xaaffbb, 0xff9248];
  const col = colors[Math.floor(Math.random() * colors.length)];
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(size * 1.3, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: col, transparent: true, opacity: 0.82, roughness: 0.8, side: THREE.DoubleSide })
  );
  canopy.position.y = size * 3.5;
  paraGroup.add(canopy);
  // Canopy stripes
  for (let i = 0; i < 6; i++) {
    const stripe = new THREE.Mesh(
      new THREE.SphereGeometry(size * 1.31, 3, 8, (i / 6) * Math.PI * 2, Math.PI / 3, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, roughness: 0.9, side: THREE.DoubleSide })
    );
    stripe.position.y = size * 3.5;
    paraGroup.add(stripe);
  }
  // Strings from canopy to stuffy
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const str = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, size * 3.0, 4),
      new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.9 })
    );
    str.position.set(Math.cos(angle) * size * 0.4, size * 2.0, Math.sin(angle) * size * 0.4);
    str.rotation.x = Math.cos(angle) * 0.18;
    str.rotation.z = -Math.sin(angle) * 0.18;
    paraGroup.add(str);
  }
  g.add(paraGroup);
  return paraGroup;
}

// ---------- Projectiles ----------
function spawnProjectile(origin, direction, opts = {}) {
  const speed = opts.speed ?? PROJECTILE_SPEED;
  const damage = opts.damage ?? 12;
  const color = opts.color ?? 0xffb14d;
  const radius = opts.radius ?? 0.2;
  const mesh = ball(radius, color, {
    emissive: color, emissiveIntensity: 0.9, segments: 8, castShadow: false,
  });
  mesh.position.copy(origin);
  // trail light
  mesh.userData = {
    velocity: direction.clone().normalize().multiplyScalar(speed),
    damage, ttl: 2.2, radius, isProjectile: true,
    homingTarget: opts.homingTarget ?? null,
    homing: opts.homing ?? false,
  };
  scene.add(mesh);
  state.projectiles.push(mesh);
}

// ---------- Turrets ----------
const TURRET_TYPES = {
  dart:        { cost: 25, range: 10, damage: 15, cooldown: 0.38, color: 0xff9248, hp:  60 },
  bubble:      { cost: 50, range: 11, damage: 28, cooldown: 0.55, color: 0x66ddee, hp:  90 },
  marshmallow: { cost: 75, range: 13, damage: 55, cooldown: 0.85, color: 0xfff0d0, hp: 130 },
  missile:     { cost: 100,range: 16, damage: 40, cooldown: 1.1,  color: 0xff5577, hp: 110 },
};

// Plush stuffed-animal turrets — each type looks like a different cute stuffie
function createTurret(type, pos) {
  const conf = TURRET_TYPES[type];
  const g = new THREE.Group();

  if (type === 'dart') {
    // Bear plush turret — tan/orange, holds a foam dart in its paw
    const BEAR = 0xe8924a;
    const body = ball(0.72, BEAR, { roughness: 0.95 });
    body.scale.set(1, 1.1, 0.9);
    body.position.y = 0.72;
    body.castShadow = true;
    g.add(body);
    // Belly patch
    const belly = ball(0.42, 0xf5c07a, { roughness: 0.9, castShadow: false });
    belly.scale.set(0.85, 0.8, 0.4);
    belly.position.set(0, 0.72, 0.62);
    g.add(belly);
    // Head
    const head = ball(0.55, BEAR, { roughness: 0.95 });
    head.position.y = 1.65;
    head.castShadow = true;
    g.add(head);
    // Ears
    for (const sx of [-1, 1]) {
      const ear = ball(0.18, BEAR, { segments: 10 });
      ear.position.set(sx * 0.45, 2.12, 0);
      g.add(ear);
      const innerEar = ball(0.1, 0xf5c07a, { segments: 8, castShadow: false });
      innerEar.position.set(sx * 0.45, 2.12, 0.1);
      g.add(innerEar);
    }
    // Button eyes
    for (const sx of [-1, 1]) {
      const eye = ball(0.065, 0x111111, { segments: 8, emissive: 0x111111, emissiveIntensity: 0.3 });
      eye.position.set(sx * 0.2, 1.72, 0.48);
      g.add(eye);
    }
    // Snout
    const snout = ball(0.2, 0xc97040, { segments: 10, roughness: 0.9 });
    snout.scale.set(1.2, 0.75, 0.6);
    snout.position.set(0, 1.55, 0.5);
    g.add(snout);
    // Dart sticking out of paw
    const dart = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.04, 1.1, 8),
      makeMat(0xff4488, { roughness: 0.7 })
    );
    dart.rotation.z = Math.PI / 2;
    dart.position.set(0.85, 0.72, 0.35);
    g.add(dart);
    const dartTip = ball(0.1, 0xffee55, { segments: 8 });
    dartTip.position.set(1.38, 0.72, 0.35);
    g.add(dartTip);
    // Hang tag
    const tag = box(0.14, 0.18, 0.02, 0xffffff);
    tag.position.set(0.68, 1.55, 0.2);
    tag.rotation.z = 0.3;
    g.add(tag);

  } else if (type === 'bubble') {
    // Frog plush turret — green, shoots bubbles from its mouth
    const FROG = 0x5ecf6a;
    const FROG_D = 0x3aaa4a;
    const body = ball(0.72, FROG, { roughness: 0.95 });
    body.scale.set(1, 1.05, 0.9);
    body.position.y = 0.72;
    body.castShadow = true;
    g.add(body);
    const belly = ball(0.46, 0xcef5d0, { roughness: 0.9, castShadow: false });
    belly.scale.set(0.85, 0.8, 0.4);
    belly.position.set(0, 0.72, 0.62);
    g.add(belly);
    const head = ball(0.6, FROG, { roughness: 0.95 });
    head.scale.set(1.1, 0.85, 1.0);
    head.position.y = 1.62;
    head.castShadow = true;
    g.add(head);
    // Bulging eyes on top of head
    for (const sx of [-1, 1]) {
      const eyeDome = ball(0.22, FROG_D, { segments: 12 });
      eyeDome.position.set(sx * 0.3, 2.12, 0.15);
      g.add(eyeDome);
      const pupil = ball(0.1, 0x111111, { segments: 8 });
      pupil.position.set(sx * 0.3, 2.12, 0.33);
      g.add(pupil);
    }
    // Wide grin
    const smile = new THREE.Mesh(
      new THREE.TorusGeometry(0.25, 0.04, 8, 16, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0x1a5a25 })
    );
    smile.position.set(0, 1.48, 0.55);
    smile.rotation.set(Math.PI, 0, 0);
    g.add(smile);
    // Bubble floating out front (translucent)
    const bubbleMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0x88eeff, transparent: true, opacity: 0.45, roughness: 0.05 })
    );
    bubbleMesh.position.set(0, 1.62, 0.9);
    g.add(bubbleMesh);
    // Hang tag
    const tag = box(0.14, 0.18, 0.02, 0xffffff);
    tag.position.set(0.7, 0.9, 0.2);
    tag.rotation.z = 0.3;
    g.add(tag);

  } else if (type === 'marshmallow') {
    // Marshmallow: Unicorn plush turret — pink/white, fires from its glowing horn
    const UNI = 0xf8b8d8;
    const body = ball(0.78, UNI, { roughness: 0.95 });
    body.scale.set(1, 1.05, 0.9);
    body.position.y = 0.78;
    body.castShadow = true;
    g.add(body);
    const belly = ball(0.48, 0xfff0f8, { roughness: 0.9, castShadow: false });
    belly.scale.set(0.82, 0.75, 0.4);
    belly.position.set(0, 0.78, 0.68);
    g.add(belly);
    const head = ball(0.58, UNI, { roughness: 0.95 });
    head.position.y = 1.72;
    head.castShadow = true;
    g.add(head);
    // Ears
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.32, 8), makeMat(UNI, { roughness: 0.9 }));
      ear.position.set(sx * 0.38, 2.18, 0);
      g.add(ear);
    }
    // Eyes (sparkly)
    for (const sx of [-1, 1]) {
      const eye = ball(0.07, 0x1a0a2a, { segments: 8 });
      eye.position.set(sx * 0.22, 1.78, 0.5);
      g.add(eye);
      const shine = ball(0.025, 0xffffff, { segments: 6, emissive: 0xffffff, emissiveIntensity: 1, castShadow: false });
      shine.position.set(sx * 0.22, 1.8, 0.56);
      g.add(shine);
    }
    // Magic horn (glowing, shoots marshmallows)
    const horn = new THREE.Mesh(
      new THREE.ConeGeometry(0.1, 0.82, 8),
      makeMat(0xffd95f, { roughness: 0.3, emissive: 0xffd95f, emissiveIntensity: 0.6 })
    );
    horn.position.set(0, 2.1, 0.52);
    horn.rotation.x = Math.PI / 2 - 0.3;
    g.add(horn);
    // Mane (colorful swirl)
    for (let i = 0; i < 5; i++) {
      const strand = ball(0.1, [0xff7eb3, 0x88c9ff, 0xffd25f, 0xaaffbb, 0xff9248][i], { segments: 8, castShadow: false });
      strand.position.set(-0.38 + i * 0.07, 1.95 + i * 0.08, -0.3);
      g.add(strand);
    }
    // Hang tag
    const tag = box(0.14, 0.18, 0.02, 0xffffff);
    tag.position.set(0.76, 1.2, 0.2);
    tag.rotation.z = 0.3;
    g.add(tag);
  } else {
    // Missile launcher: stuffed rocket-plane plush — red/white, fires homing missiles
    const ROCK = 0xff5577;
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.42, 1.8, 10),
      makeMat(ROCK, { roughness: 0.85 })
    );
    body.rotation.z = Math.PI / 2;
    body.position.set(0, 1.1, 0);
    body.castShadow = true;
    g.add(body);
    // Nose cone
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.38, 0.7, 10),
      makeMat(0xffffff, { roughness: 0.8 })
    );
    nose.rotation.z = Math.PI / 2;
    nose.position.set(1.2, 1.1, 0);
    g.add(nose);
    // Wings
    for (const sz of [-1, 1]) {
      const wing = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.1, 0.8),
        makeMat(0xffffff, { roughness: 0.9 })
      );
      wing.position.set(0, 1.1, sz * 0.65);
      g.add(wing);
    }
    // Tail fins
    for (const sz of [-1, 1]) {
      const fin = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.55, 0.08),
        makeMat(ROCK, { roughness: 0.9 })
      );
      fin.position.set(-0.7, 1.4, sz * 0.38);
      g.add(fin);
    }
    // Button eyes on nose
    for (const sz of [-1, 1]) {
      const eye = ball(0.07, 0x111111, { segments: 8 });
      eye.position.set(1.0, 1.22, sz * 0.18);
      g.add(eye);
    }
    // Smile
    const smile = new THREE.Mesh(
      new THREE.TorusGeometry(0.12, 0.03, 6, 12, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0x330000 })
    );
    smile.position.set(1.05, 1.0, 0);
    smile.rotation.set(Math.PI, Math.PI / 2, 0);
    g.add(smile);
    // Exhaust glow
    const exhaust = ball(0.22, 0xff9248, { segments: 8, emissive: 0xff9248, emissiveIntensity: 1.2, castShadow: false });
    exhaust.position.set(-1.18, 1.1, 0);
    g.add(exhaust);
    // Hang tag
    const tag = box(0.14, 0.18, 0.02, 0xffffff);
    tag.position.set(-0.2, 0.5, 0.42);
    tag.rotation.z = 0.3;
    g.add(tag);
  }

  // Shared: plush seam line on base
  const seam = new THREE.Mesh(
    new THREE.TorusGeometry(0.72, 0.025, 6, 24),
    makeMat(0xffffff, { roughness: 0.9, emissive: 0xffffff, emissiveIntensity: 0.15 })
  );
  seam.position.y = 0.72;
  seam.rotation.x = Math.PI / 2;
  g.add(seam);

  // Turret head group for rotation toward enemy
  const head = new THREE.Group();
  g.add(head);

  // HP bar above the turret (billboarded)
  const tBarGroup = new THREE.Group();
  tBarGroup.position.y = 2.7;
  const tBarBg = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 0.14),
    new THREE.MeshBasicMaterial({ color: 0x111111 })
  );
  tBarGroup.add(tBarBg);
  const tBarFg = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 0.14),
    new THREE.MeshBasicMaterial({ color: 0x6ddc9a })
  );
  tBarFg.position.z = 0.002;
  tBarGroup.add(tBarFg);
  g.add(tBarGroup);

  g.position.copy(pos);
  g.position.y = 0;
  g.userData = {
    type, cooldown: 0, conf, head,
    hp: conf.hp, maxHp: conf.hp,
    hpBar: tBarFg, barGroup: tBarGroup,
    isTurret: true,
  };
  scene.add(g);
  state.turrets.push(g);
  return g;
}

// ---------- Pickups (Lily's farts) ----------
const PICKUP_INFO = {
  rapidfire: { color: 0xffd95f, label: '⚡ Rapid Fire (8s)' },
  bigdamage: { color: 0xff5577, label: '💥 Big Damage (10s)' },
  triple:    { color: 0x77ddff, label: '🎯 Triple Shot (10s)' },
  heal:      { color: 0x88ff99, label: '❤️ +50 HP' },
  sparkles:  { color: 0xffffff, label: '✨ +30 Sparkles' },
  ammo:      { color: 0xff9248, label: '🔫 +40 Ammo' },
};
// Weighted distribution: ammo + heal dominate so survival is sustainable
const PICKUP_WEIGHTS = [
  ['ammo', 5],
  ['heal', 4],
  ['sparkles', 2],
  ['rapidfire', 1],
  ['bigdamage', 1],
  ['triple', 1],
];
function pickPickupType() {
  const total = PICKUP_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [t, w] of PICKUP_WEIGHTS) {
    r -= w;
    if (r <= 0) return t;
  }
  return 'ammo';
}

function spawnFartCloud() {
  // Quick cosmetic puff above the bed
  const cloud = ball(1.3, 0x9be36a, { emissive: 0x9be36a, emissiveIntensity: 0.4, segments: 12, castShadow: false });
  cloud.material.transparent = true;
  cloud.material.opacity = 0.5;
  const pos = new THREE.Vector3(-10 + (Math.random() - 0.5) * 4, 3.5, -10 + (Math.random() - 0.5) * 3);
  cloud.position.copy(pos);
  cloud.userData = { type: 'cloud', life: 1.6, isParticle: true, vy: 1.5 };
  scene.add(cloud);
  state.particles.push(cloud);

  // A few small bubbles drift up too
  for (let i = 0; i < 4; i++) {
    const small = ball(0.18 + Math.random() * 0.12, 0xbef07a, {
      emissive: 0x9be36a, emissiveIntensity: 0.3, segments: 8, castShadow: false,
    });
    small.material.transparent = true;
    small.material.opacity = 0.5;
    small.position.copy(pos);
    small.position.x += (Math.random() - 0.5) * 1.5;
    small.position.z += (Math.random() - 0.5) * 1.5;
    small.userData = { type: 'cloud', life: 1.2 + Math.random(), isParticle: true, vy: 1 + Math.random() };
    scene.add(small);
    state.particles.push(small);
  }

  // Pick a power-up (weighted toward ammo and heal so they're sustainable)
  const type = pickPickupType();
  setTimeout(() => {
    if (!state.running) return;
    const g = new THREE.Group();
    // The fart bubble: translucent green sphere
    const bubble = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 24, 18),
      new THREE.MeshStandardMaterial({
        color: 0xc8f48a,
        emissive: 0x9be36a, emissiveIntensity: 0.25,
        transparent: true, opacity: 0.34,
        roughness: 0.05, metalness: 0.0,
      })
    );
    g.add(bubble);
    // Bubble highlight (fake specular)
    const shine = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })
    );
    shine.position.set(-0.38, 0.45, 0.4);
    g.add(shine);
    // The power-up floating inside the bubble
    const inner = ball(0.42, PICKUP_INFO[type].color, {
      emissive: PICKUP_INFO[type].color, emissiveIntensity: 0.85, segments: 16, castShadow: false,
    });
    g.add(inner);

    // Spawn the bubble just south of the bed so it appears NEAR the bed,
    // not inside it. (Bed AABB: x∈[-15.5,-4.5], z∈[-13.75,-6.25].)
    const bubbleX = -10 + (Math.random() - 0.5) * 6;          // -13 .. -7 (within bed width)
    const bubbleZ = -4.2 + Math.random() * 1.5;               // -4.2 .. -2.7 (south of bed)
    g.position.set(bubbleX, 1.8, bubbleZ);
    const driftAngle = Math.random() * Math.PI * 2;
    const driftSpeed = 1.0 + Math.random() * 1.0;
    g.userData = {
      type, isPickup: true, life: 18,
      bob: Math.random() * 6, spin: 0,
      inner, bubble,
      drift: new THREE.Vector3(Math.cos(driftAngle) * driftSpeed, 0, Math.sin(driftAngle) * driftSpeed),
      driftChangeTimer: 2 + Math.random() * 2,
    };
    scene.add(g);
    state.pickups.push(g);
  }, 700);

  audio.fart();
  showMessage('💨 Chelsea farted! Bubble incoming!', 2.2);
}

function applyPickup(type) {
  switch (type) {
    case 'rapidfire':
      state.tempBuffs.push({ time: 8, restore: ((v) => () => state.weapons.dart.cooldown = v)(state.weapons.dart.cooldown) });
      state.weapons.dart.cooldown = 0.08;
      break;
    case 'bigdamage':
      state.tempBuffs.push({ time: 10, restore: ((v) => () => state.weapons.dart.damage = v)(state.weapons.dart.damage) });
      state.weapons.dart.damage = 40;
      break;
    case 'triple':
      state.tempBuffs.push({ time: 10, restore: () => state.tripleShot = false });
      state.tripleShot = true;
      break;
    case 'heal':
      flashy.userData.hp = Math.min(flashy.userData.maxHp, flashy.userData.hp + 50);
      break;
    case 'sparkles':
      state.sparkles += 30;
      state.totalSparklesEarned += 30;
      break;
    case 'ammo':
      state.ammo = Math.min(state.maxAmmo, state.ammo + 40);
      break;
  }
  showMessage(PICKUP_INFO[type].label, 1.6);
  updateHUD();
}

// ---------- Particles ----------
function spawnHitBurst(pos, color = 0xffe07a) {
  for (let i = 0; i < 6; i++) {
    const p = ball(0.1 + Math.random() * 0.08, color, {
      emissive: color, emissiveIntensity: 0.8, segments: 6, castShadow: false,
    });
    p.position.copy(pos);
    const v = new THREE.Vector3(
      (Math.random() - 0.5) * 5,
      Math.random() * 4 + 1,
      (Math.random() - 0.5) * 5,
    );
    p.userData = { velocity: v, life: 0.6, isParticle: true };
    scene.add(p);
    state.particles.push(p);
  }
}

function spawnDeathPoof(pos, color) {
  for (let i = 0; i < 12; i++) {
    const p = ball(0.18 + Math.random() * 0.12, color, {
      emissive: color, emissiveIntensity: 0.6, segments: 6, castShadow: false,
    });
    p.material.transparent = true;
    p.material.opacity = 0.9;
    p.position.copy(pos);
    p.position.y += 0.5;
    const v = new THREE.Vector3(
      (Math.random() - 0.5) * 6,
      Math.random() * 5,
      (Math.random() - 0.5) * 6,
    );
    p.userData = { velocity: v, life: 0.9, isParticle: true, fade: true };
    scene.add(p);
    state.particles.push(p);
  }
}

// ---------- Input ----------
const keys = {};
const GAME_KEYS = new Set(['w','a','s','d','t','m','1','2','3','4',' ','escape']);
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (GAME_KEYS.has(k)) e.preventDefault();
  keys[k] = true;
  if (k === 't') togglePlacing();
  if (k === '1') selectTurretType('dart');
  if (k === '2') selectTurretType('bubble');
  if (k === '3') selectTurretType('marshmallow');
  if (k === '4') selectTurretType('missile');
  if (k === ' ' && state.running) {
    if (flashy.position.y < 0.05) { flashy.userData.vy = 8; audio.jump(); }
  }
  if (k === 'm') {
    const m = audio.toggleMute();
    showMessage(m ? '🔇 Sound off' : '🔊 Sound on', 1.2);
  }
  if (k === 'escape') {
    state.placingTurret = false;
    ghost.visible = false;
  }
});

// ---------- Camera modes ----------
// Top-down only — fixed overhead follow camera, mouse-aimed via floor raycast.
function engageTopDown() {
  // Free the cursor and hide first-person crosshair; show the ground reticle ring
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  document.getElementById('crosshair')?.classList.add('hidden');
  reticle.visible = true;
}
window.addEventListener('keyup', e => {
  const k = e.key.toLowerCase();
  if (GAME_KEYS.has(k)) e.preventDefault();
  keys[k] = false;
});

function togglePlacing() {
  if (!state.running) return;
  if (!state.weapons[state.turretType].unlocked) {
    showMessage(`${state.turretType} turret locked!`, 1.4);
    return;
  }
  state.placingTurret = !state.placingTurret;
  ghost.visible = state.placingTurret;
  if (state.placingTurret) {
    ghost.material.color.setHex(TURRET_TYPES[state.turretType].color);
  }
}

function selectTurretType(type) {
  if (!state.weapons[type]?.unlocked) {
    showMessage(`${type} turret locked! Reach the right wave to unlock.`, 1.8);
    return;
  }
  state.turretType = type;
  document.querySelectorAll('.weapon-slot').forEach(el => {
    el.classList.toggle('active', el.dataset.type === type);
  });
  if (state.placingTurret) ghost.material.color.setHex(TURRET_TYPES[type].color);
}

document.querySelectorAll('.weapon-slot').forEach(el => {
  el.addEventListener('click', () => selectTurretType(el.dataset.type));
});

// Mouse
const mouse = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const aimPoint = new THREE.Vector3();

window.addEventListener('mousemove', e => {
  // Top-down view uses the cursor position for aiming via floor raycast
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
});

window.addEventListener('mousedown', e => {
  if (!state.running) return;
  if (e.button !== 0) return;
  if (state.placingTurret) {
    placeTurretAtAim();
  } else {
    shootFromFlashy();
  }
});

function placeTurretAtAim() {
  const conf = TURRET_TYPES[state.turretType];
  if (state.sparkles < conf.cost) {
    showMessage(`Need ${conf.cost} ✨ (have ${state.sparkles})`, 1.6);
    return;
  }
  // Must be inside the room
  if (Math.abs(aimPoint.x) > ROOM.w / 2 - 1.5 || Math.abs(aimPoint.z) > ROOM.d / 2 - 1.5) {
    showMessage('Place inside the room!', 1.4);
    return;
  }
  // Don't place too close to obstacles
  if (aimPoint.distanceTo(new THREE.Vector3(ORB_POSITION.x, 0, ORB_POSITION.z)) < 4) {
    showMessage('Too close to the orb!', 1.4);
    return;
  }
  if (Math.abs(aimPoint.x - (-10)) < 6 && Math.abs(aimPoint.z - (-10)) < 4.5) {
    showMessage('Can\'t place on the bed!', 1.4);
    return;
  }
  // Not too close to other turrets
  for (const t of state.turrets) {
    if (t.position.distanceTo(aimPoint) < 2.5) {
      showMessage('Too close to another turret!', 1.4);
      return;
    }
  }
  createTurret(state.turretType, aimPoint.clone());
  state.sparkles -= conf.cost;
  state.placingTurret = false;
  ghost.visible = false;
  audio.place();
  updateHUD();
}

function shootFromFlashy() {
  if (flashy.userData.fireCooldown > 0) return;
  if (state.ammo <= 0) {
    // Out of ammo — brief click + nudge
    if (!shootFromFlashy._lastEmptyAt || performance.now() - shootFromFlashy._lastEmptyAt > 500) {
      audio.place();
      showMessage('Out of ammo! 💨 Wait for Chelsea to fart', 1.4);
      shootFromFlashy._lastEmptyAt = performance.now();
    }
    flashy.userData.fireCooldown = 0.18;
    return;
  }

  // Fire from Flashy's hand height — roughly mid-body so darts hit enemy bodies
  const origin = flashy.position.clone();
  origin.y = 0.9;

  // Aim toward the aim point in 3D. If a specific enemy is roughly under the
  // cursor, aim at its body; otherwise aim at the floor-level aim point.
  const target = new THREE.Vector3(aimPoint.x, 0.5, aimPoint.z);
  let nearestEnemy = null, nearestDist = 3.0;
  for (const e of state.enemies) {
    const dx = e.position.x - aimPoint.x;
    const dz = e.position.z - aimPoint.z;
    const d = Math.hypot(dx, dz);
    if (d < nearestDist) { nearestEnemy = e; nearestDist = d; }
  }
  if (nearestEnemy) {
    target.set(
      nearestEnemy.position.x,
      nearestEnemy.position.y + nearestEnemy.userData.size * 0.6,
      nearestEnemy.position.z
    );
  }

  const dir = new THREE.Vector3().subVectors(target, origin);
  if (dir.lengthSq() < 0.001) return;
  dir.normalize();

  flashy.userData.fireCooldown = state.weapons.dart.cooldown;
  flashy.userData.lastShotAt = performance.now();
  // Face shot direction (yaw only)
  flashy.rotation.y = Math.atan2(dir.x, dir.z);

  const dmg = state.weapons.dart.damage;
  if (state.tripleShot && state.ammo >= 3) {
    for (let i = -1; i <= 1; i++) {
      const angle = i * 0.18;
      const d = dir.clone();
      const c = Math.cos(angle), s = Math.sin(angle);
      d.set(d.x * c - d.z * s, d.y, d.x * s + d.z * c);
      spawnProjectile(origin, d, { damage: dmg });
    }
    state.ammo -= 3;
  } else {
    spawnProjectile(origin, dir, { damage: dmg });
    state.ammo -= 1;
  }
  audio.shoot();
  updateHUD();
}

// ---------- Wave management ----------
function startWave(n) {
  const lvl = LEVELS[Math.min(n - 1, LEVELS.length - 1)];
  state.wave = n;
  state.enemiesToSpawn = lvl.count;
  state.spawnTimer = 1.0;
  state.spawnInterval = lvl.spawnInterval;
  state.currentTypes = lvl.types;
  state.currentReward = lvl.reward;
  state.inIntermission = false;
  if (lvl.unlock && !state.weapons[lvl.unlock].unlocked) {
    state.weapons[lvl.unlock].unlocked = true;
    const el = document.querySelector(`.weapon-slot[data-type="${lvl.unlock}"]`);
    if (el) el.classList.remove('locked');
    showMessage(`🛠️ Unlocked: ${lvl.unlock.toUpperCase()} turret!`, 2.8);
  } else {
    showMessage(`Wave ${n} — Defend the Orb!`, 2.2);
  }
  audio.wave();
  updateHUD();
}

function endWave() {
  state.inIntermission = true;
  state.intermissionTime = 10;
  state.sparkles += state.currentReward;
  state.totalSparklesEarned += state.currentReward;
  showMessage(`✅ Wave ${state.wave} cleared! +${state.currentReward}✨  · Place turrets!`, 3.2);
  updateHUD();
}

function gameOver(victory = false, reason = null) {
  if (!state.running) return; // guard against double-fire
  state.running = false;
  state.endReason = victory ? 'victory' : (reason || 'orb');
  audio.stopMusic();
  audio.over();

  // --- Compute final score ---
  const wavesCleared = victory ? state.wave : Math.max(0, state.wave - 1);
  const breakdown = {
    waves:    wavesCleared * 200,
    kills:    state.kills * 15,
    sparkles: state.totalSparklesEarned,
    orbBonus: state.orbLives * 1000,
    victory:  victory ? 5000 : 0,
  };
  const score = breakdown.waves + breakdown.kills + breakdown.sparkles + breakdown.orbBonus + breakdown.victory;

  // --- Save to highscores ---
  const entry = { name: state.playerName, score, wave: state.wave, kills: state.kills, date: Date.now() };
  const rank = saveHighscore(entry);

  const titles = {
    victory: '🌟 Morning!',
    orb:     '💔 The Orb Was Stolen!',
    flashy:  '💔 Flashy Was Knocked Out!',
  };
  const messages = {
    victory: `${state.playerName} survived all ${state.wave} waves. The Orb is safe!`,
    orb:     `The stuffies took the Orb on wave ${state.wave}. Flashy needs more turrets!`,
    flashy:  `${state.playerName} was overwhelmed on wave ${state.wave}. Place defensive turrets and dodge attacks!`,
  };
  document.getElementById('end-title').textContent = titles[state.endReason];
  document.getElementById('end-text').textContent  = messages[state.endReason];

  // Score summary box
  const rankLabel = rank > 0 && rank <= 10
    ? `🏆 New high score — rank #${rank}!`
    : (rank > 0 ? `Ranked #${rank}` : '');
  document.getElementById('score-summary').innerHTML = `
    <div class="ss-label">Final Score</div>
    <div class="ss-score">${score.toLocaleString()}</div>
    <div class="ss-breakdown">
      Waves cleared: ${wavesCleared} (+${breakdown.waves.toLocaleString()}) ·
      Kills: ${state.kills} (+${breakdown.kills.toLocaleString()})<br/>
      Sparkles earned: ${state.totalSparklesEarned.toLocaleString()} ·
      Orb bonus: ${state.orbLives} × 1000 = ${breakdown.orbBonus.toLocaleString()}
      ${victory ? `<br/>🏆 Victory bonus: +5,000` : ''}
    </div>
    ${rankLabel ? `<div class="ss-rank">${rankLabel}</div>` : ''}
  `;
  renderHighscores('hs-list-end', 'hs-source-end', entry);
  // Re-fetch the global table in the background, then re-render
  loadGlobalHighscores().then(() => renderHighscores('hs-list-end', 'hs-source-end', entry));

  // Wire the "Submit to Global Leaderboard" button (each end-screen rebuild)
  const submitBtn = document.getElementById('submit-global-btn');
  if (submitBtn) {
    submitBtn.onclick = () => {
      window.open(buildSubmitUrl(entry), '_blank', 'noopener');
      submitBtn.textContent = '✅ Opened submission — finish on GitHub';
      submitBtn.classList.add('submitted');
    };
  }

  document.getElementById('end-screen').classList.remove('hidden');
}

// ---------- Highscores (persisted to localStorage) ----------
const HS_KEY = 'fd_highscores';
const HS_MAX = 10;

// Repo coordinates for the global leaderboard. raw.githubusercontent.com
// serves files with permissive CORS so the browser can fetch directly.
const GH_OWNER = 'bostacks';
const GH_REPO  = 'flashy-defense';
const HS_URL   = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/main/HIGHSCORES.md`;
const HS_TABLE_START = '<!-- HIGHSCORES_TABLE_START -->';
const HS_TABLE_END   = '<!-- HIGHSCORES_TABLE_END -->';

// Cache the parsed global list so re-renders don't re-fetch
let globalScores = null;     // null = not loaded; array = loaded (possibly empty)
let globalLoadError = null;  // string if last load failed

function loadLocalHighscores() {
  try { return JSON.parse(localStorage.getItem(HS_KEY) || '[]'); }
  catch { return []; }
}

function saveHighscore(entry) {
  const list = loadLocalHighscores();
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  const trimmed = list.slice(0, HS_MAX);
  localStorage.setItem(HS_KEY, JSON.stringify(trimmed));
  const idx = trimmed.indexOf(entry);
  return idx === -1 ? 0 : idx + 1;
}

// Parse the markdown table out of HIGHSCORES.md
function parseGlobalTable(md) {
  const start = md.indexOf(HS_TABLE_START);
  const end   = md.indexOf(HS_TABLE_END);
  if (start < 0 || end < 0) return [];
  const block = md.slice(start + HS_TABLE_START.length, end);
  const out = [];
  for (const raw of block.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    const cells = line.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    if (cells.length < 6) continue;
    if (cells[0] === 'Rank' || /^-+$/.test(cells[0])) continue;     // header / divider
    if (cells[1].startsWith('_')) continue;                          // placeholder row
    const score = parseInt(cells[2].replace(/,/g, ''), 10);
    const wave  = parseInt(cells[3], 10);
    const kills = parseInt(cells[4], 10);
    if (Number.isNaN(score)) continue;
    out.push({ name: cells[1], score, wave, kills, date: cells[5] });
  }
  return out;
}

async function loadGlobalHighscores() {
  try {
    // Cache-bust: avoid a stale CDN copy after a fresh action commit
    const res = await fetch(`${HS_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    globalScores = parseGlobalTable(await res.text());
    globalLoadError = null;
  } catch (e) {
    globalLoadError = e.message || String(e);
    globalScores = [];
  }
}

function renderHighscores(listId, sourceId, highlightEntry = null) {
  const list = globalScores ?? loadLocalHighscores();
  const usingGlobal = globalScores !== null && globalLoadError === null;

  const sourceEl = sourceId && document.getElementById(sourceId);
  if (sourceEl) {
    if (globalScores === null)       { sourceEl.textContent = 'loading…'; sourceEl.className = 'hs-source'; }
    else if (globalLoadError)        { sourceEl.textContent = 'local only (offline)'; sourceEl.className = 'hs-source error'; }
    else                             { sourceEl.textContent = '🌐 global'; sourceEl.className = 'hs-source global'; }
  }

  const el = document.getElementById(listId);
  if (!el) return;
  if (list.length === 0) {
    el.innerHTML = '<li class="hs-empty">No scores yet — be the first!</li>';
    return;
  }
  el.innerHTML = list.slice(0, HS_MAX).map((e, i) => {
    // Highlight the player's most recent submission by matching name+score
    const isNew = highlightEntry &&
      e.name === highlightEntry.name &&
      e.score === highlightEntry.score &&
      e.wave === highlightEntry.wave;
    return `<li class="${isNew ? 'hs-new' : ''}">
      <span class="hs-rank">${i + 1}.</span>
      <span class="hs-name">${escapeHtml(e.name)}</span>
      <span class="hs-score">${e.score.toLocaleString()}</span>
      <span class="hs-wave">W${e.wave}</span>
    </li>`;
  }).join('');
}

// Build the GitHub "new issue" URL prefilled with the score data. The Action
// in .github/workflows/highscores.yml will parse and append it.
function buildSubmitUrl(entry) {
  const data = JSON.stringify({
    name:  entry.name,
    score: entry.score,
    wave:  entry.wave,
    kills: entry.kills,
  });
  const body =
`A new submission for the global leaderboard.

<!-- highscore-data ${data} -->

Score:  **${entry.score.toLocaleString()}**
Wave:   ${entry.wave}
Kills:  ${entry.kills}
Player: ${entry.name}

_Submitted from the in-game leaderboard form._`;
  const params = new URLSearchParams({
    title:  `Score: ${entry.score.toLocaleString()} by ${entry.name} (Wave ${entry.wave})`,
    body,
    labels: 'highscore',
  });
  return `https://github.com/${GH_OWNER}/${GH_REPO}/issues/new?${params}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

// ---------- HUD ----------
function updateHUD() {
  document.getElementById('wave-num').textContent = state.wave || 1;
  document.getElementById('orb-status').textContent = `${state.orbLives}/3`;
  document.getElementById('hp').textContent = Math.max(0, Math.round(flashy.userData.hp));
  const ammoEl = document.getElementById('ammo-count');
  if (ammoEl) {
    ammoEl.textContent = Math.max(0, state.ammo);
    ammoEl.style.color = state.ammo <= 0 ? '#ff5d7a' : state.ammo < 20 ? '#ffc94a' : '';
  }
  document.getElementById('sparkle-count').textContent = state.sparkles;
  document.getElementById('enemy-count').textContent = state.enemies.length + state.enemiesToSpawn;
  const inter = document.getElementById('intermission');
  if (state.inIntermission && state.running) {
    inter.textContent = `⏳ Next wave: ${Math.max(0, Math.ceil(state.intermissionTime))}s`;
    inter.style.display = '';
  } else {
    inter.style.display = 'none';
  }
}

function showMessage(text, time = 2) {
  const el = document.getElementById('message');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(showMessage._t);
  showMessage._t = setTimeout(() => el.classList.add('hidden'), time * 1000);
}

// ---------- Update loop ----------
function updatePlayer(dt) {
  // Top-down WASD: world-space movement (camera doesn't rotate with player)
  // W = away from screen (-Z), S = toward (+Z), A/D = left/right (-X/+X)
  const move = new THREE.Vector3();
  if (keys['w']) move.z -= 1;
  if (keys['s']) move.z += 1;
  if (keys['a']) move.x -= 1;
  if (keys['d']) move.x += 1;

  const moving = move.lengthSq() > 0;
  if (moving) {
    move.normalize().multiplyScalar(FLASHY_SPEED * dt);
    flashy.position.add(move);
    flashy.position.x = THREE.MathUtils.clamp(flashy.position.x, -ROOM.w / 2 + 1, ROOM.w / 2 - 1);
    flashy.position.z = THREE.MathUtils.clamp(flashy.position.z, -ROOM.d / 2 + 1, ROOM.d / 2 - 1);
    resolveObstacleCollision(flashy.position);
  }
  // Face the cursor (aim point) most of the time; turn toward movement direction
  // briefly after a shot so the body matches the dart's facing.
  if (performance.now() - flashy.userData.lastShotAt > 500 && !moving) {
    // Idle: face the cursor
    const ax = aimPoint.x - flashy.position.x;
    const az = aimPoint.z - flashy.position.z;
    if (ax * ax + az * az > 0.04) flashy.rotation.y = Math.atan2(ax, az);
  } else if (moving) {
    flashy.rotation.y = Math.atan2(move.x, move.z);
  }

  // Walk animation (stuffed-animal waddle)
  const u = flashy.userData;
  const R = u.rest;
  if (moving) {
    u.walkPhase += dt * 11;
    const ph = u.walkPhase;
    u.body.position.y    = R.bodyY + Math.abs(Math.sin(ph * 2)) * 0.07;
    u.footL.position.y   = R.footY + Math.max(0, Math.sin(ph)) * 0.18;
    u.footR.position.y   = R.footY + Math.max(0, -Math.sin(ph)) * 0.18;
    u.padL.position.y    = R.padY  + Math.max(0, Math.sin(ph)) * 0.18;
    u.padR.position.y    = R.padY  + Math.max(0, -Math.sin(ph)) * 0.18;
    // Arms swing forward/back along Flashy's local Z (facing direction)
    u.armL.position.z    = R.armZ  + Math.sin(ph) * 0.22;
    u.armR.position.z    = R.armZ  - Math.sin(ph) * 0.22;
    u.handL.position.z   = R.handZ + Math.sin(ph) * 0.22;
    u.handR.position.z   = R.handZ - Math.sin(ph) * 0.22;
    // Cute waddle (rotate around facing axis)
    flashy.rotation.z = Math.sin(ph) * 0.08;
  } else {
    // Settle back to rest pose
    u.body.position.y  += (R.bodyY - u.body.position.y) * 0.2;
    u.footL.position.y += (R.footY - u.footL.position.y) * 0.25;
    u.footR.position.y += (R.footY - u.footR.position.y) * 0.25;
    u.padL.position.y  += (R.padY  - u.padL.position.y) * 0.25;
    u.padR.position.y  += (R.padY  - u.padR.position.y) * 0.25;
    u.armL.position.z  += (R.armZ  - u.armL.position.z) * 0.2;
    u.armR.position.z  += (R.armZ  - u.armR.position.z) * 0.2;
    u.handL.position.z += (R.handZ - u.handL.position.z) * 0.2;
    u.handR.position.z += (R.handZ - u.handR.position.z) * 0.2;
    flashy.rotation.z *= 0.85;
  }

  // Gravity / jump
  flashy.userData.vy -= 22 * dt;
  flashy.position.y += flashy.userData.vy * dt;
  if (flashy.position.y < 0) { flashy.position.y = 0; flashy.userData.vy = 0; }

  // Fire cooldown
  if (flashy.userData.fireCooldown > 0) flashy.userData.fireCooldown -= dt;

  // Top-down camera: smooth follow above and slightly behind Flashy
  const desired = flashy.position.clone().add(CAMERA_OFFSET);
  camera.position.lerp(desired, 0.12);
  const tgt = flashy.position.clone(); tgt.y = 1;
  camera.lookAt(tgt);

  // Aim point: raycast from mouse cursor onto the floor plane
  raycaster.setFromCamera(mouse, camera);
  const hit = raycaster.ray.intersectPlane(groundPlane, aimPoint);
  if (!hit) {
    aimPoint.copy(flashy.position);
    aimPoint.y = 0;
  }
  reticle.position.set(aimPoint.x, 0.05, aimPoint.z);

  // Turret placement ghost
  if (state.placingTurret) {
    ghost.position.set(aimPoint.x, 0.6, aimPoint.z);
    ghost.material.opacity = state.sparkles >= TURRET_TYPES[state.turretType].cost ? 0.35 : 0.15;
  }

  // Buffs
  for (const b of state.tempBuffs) {
    b.time -= dt;
    if (b.time <= 0) { b.restore(); b.done = true; }
  }
  state.tempBuffs = state.tempBuffs.filter(b => !b.done);
}

function updateEnemies(dt) {
  for (const e of state.enemies) {
    // Parachuting stuffies fall until they land
    if (e.userData.airborne) {
      e.position.y -= 2.2 * dt;
      e.userData.bob += dt * 2;
      // Gentle horizontal drift while falling
      e.position.x += Math.sin(e.userData.bob * 0.7) * 0.3 * dt;
      if (e.userData.barGroup) e.userData.barGroup.lookAt(camera.position);
      if (e.position.y <= 0) {
        e.position.y = 0;
        e.userData.airborne = false;
        // Remove parachute
        if (e.userData.paraGroup) {
          e.remove(e.userData.paraGroup);
          e.userData.paraGroup = null;
        }
      }
      continue;  // skip ground movement while airborne
    }

    // ---- Pick a target ----
    // Aggressive enemies prefer nearby turrets/Flashy; everyone defaults to
    // walking toward the orb. The chosen target overrides the movement goal.
    let targetX = ORB_POSITION.x, targetZ = ORB_POSITION.z;
    let inAttackRange = false;
    let attackTarget = null;
    if (e.userData.canAttack) {
      let nearest = null, nd = Infinity;
      // Check turrets
      for (const t of state.turrets) {
        const d = Math.hypot(t.position.x - e.position.x, t.position.z - e.position.z);
        if (d < 8 && d < nd) { nd = d; nearest = t; }
      }
      // Check Flashy
      const fd = Math.hypot(flashy.position.x - e.position.x, flashy.position.z - e.position.z);
      if (fd < 7 && fd < nd) { nd = fd; nearest = flashy; }
      if (nearest) {
        targetX = nearest.position.x;
        targetZ = nearest.position.z;
        if (nd < e.userData.attackRange) {
          inAttackRange = true;
          attackTarget = nearest;
        }
      }
    }

    const dx = targetX - e.position.x;
    const dz = targetZ - e.position.z;
    const dist = Math.hypot(dx, dz);

    // Separation from other enemies
    let sx = 0, sz = 0;
    for (const o of state.enemies) {
      if (o === e) continue;
      const dxo = e.position.x - o.position.x;
      const dzo = e.position.z - o.position.z;
      const d2 = dxo * dxo + dzo * dzo;
      if (d2 < 1.5 && d2 > 0.001) {
        sx += dxo / d2;
        sz += dzo / d2;
      }
    }

    if (inAttackRange) {
      // Stop and attack
      e.rotation.y = Math.atan2(dx, dz);
      e.userData.attackCooldown -= dt;
      if (e.userData.attackCooldown <= 0) {
        const dmg = e.userData.dps * 0.6; // 0.6s per swipe
        attackTarget.userData.hp -= dmg;
        e.userData.attackCooldown = 0.6;
        spawnHitBurst(attackTarget.position.clone().add(new THREE.Vector3(0, 1, 0)), 0xff5577);
        audio.hit();
        if (attackTarget === flashy) updateHUD();
        if (attackTarget.userData.hp <= 0) {
          if (attackTarget === flashy) {
            gameOver(false, 'flashy');
            return;
          } else if (attackTarget.userData.isTurret) {
            attackTarget.userData.dead = true;
            spawnDeathPoof(attackTarget.position, attackTarget.userData.conf.color);
            showMessage('🛠️ Turret destroyed!', 1.2);
          }
        }
        // Low-HP warning so the player notices they're being hit
        if (attackTarget === flashy) {
          if (flashy.userData.hp < 40 && (!showMessage._lastHpWarn || performance.now() - showMessage._lastHpWarn > 3000)) {
            showMessage(`⚠️ Flashy is hurt! HP: ${Math.round(flashy.userData.hp)}`, 1.3);
            showMessage._lastHpWarn = performance.now();
          }
        }
      }
    } else if (dist > 0.001) {
      const nx = dx / dist + sx * 0.3;
      const nz = dz / dist + sz * 0.3;
      const len = Math.hypot(nx, nz) || 1;
      e.position.x += (nx / len) * e.userData.speed * dt;
      e.position.z += (nz / len) * e.userData.speed * dt;
      e.rotation.y = Math.atan2(nx, nz);
    }

    // bob
    e.userData.bob += dt * 6;
    e.position.y = Math.abs(Math.sin(e.userData.bob)) * 0.15;

    // HP bar billboard (rotate whole group to face camera)
    if (e.userData.barGroup) {
      e.userData.barGroup.lookAt(camera.position);
      const ratio = Math.max(0, e.userData.hp / e.userData.maxHp);
      e.userData.hpBar.scale.x = ratio;
    }

    // Reached orb?
    if (dist < 2.4) {
      state.orbLives -= 1;
      e.userData.dead = true;
      e.userData.stoleOrb = true;
      // Pulse orb light red
      orbLight.color.setHex(0xff5577);
      setTimeout(() => orbLight.color.setHex(0xffd07a), 350);
      audio.orbHit();
      showMessage(`😱 Orb stolen! ${Math.max(0, state.orbLives)} lives left`, 2);
      if (state.orbLives <= 0) gameOver(false, 'orb');
      updateHUD();
    }
  }
  state.enemies = state.enemies.filter(e => {
    if (e.userData.dead) {
      if (!e.userData.stoleOrb) {
        spawnDeathPoof(e.position, e.userData.color || 0xffcde0);
      }
      scene.remove(e);
      return false;
    }
    return true;
  });
}

function updateProjectiles(dt) {
  for (const p of state.projectiles) {
    p.position.addScaledVector(p.userData.velocity, dt);
    // Homing missiles steer toward their target
    if (p.userData.homing && p.userData.homingTarget && !p.userData.homingTarget.userData.dead) {
      const toTarget = new THREE.Vector3().subVectors(p.userData.homingTarget.position, p.position);
      toTarget.normalize();
      p.userData.velocity.lerp(toTarget.clone().multiplyScalar(18), dt * 3.5);
    }
    p.userData.ttl -= dt;
    if (p.userData.ttl <= 0) { p.userData.dead = true; continue; }
    // Floor / ceiling bounds
    if (p.position.y < 0 || p.position.y > 20) p.userData.dead = true;

    for (const e of state.enemies) {
      const dx = p.position.x - e.position.x;
      const dz = p.position.z - e.position.z;
      const dy = p.position.y - (e.position.y + e.userData.size * 0.6);
      const d = Math.hypot(dx, dy, dz);
      if (d < e.userData.size + p.userData.radius) {
        e.userData.hp -= p.userData.damage;
        p.userData.dead = true;
        spawnHitBurst(p.position, p.material.color.getHex());
        audio.hit();
        if (e.userData.hp <= 0) {
          e.userData.dead = true;
          const reward = e.userData.type === 'sassinator' ? 40
            : (e.userData.type === 'skyler' || e.userData.type === 'honey') ? 12 : 5;
          state.sparkles += reward;
          state.totalSparklesEarned += reward;
          state.kills += 1;
          audio.kill();
          updateHUD();
        }
        break;
      }
    }
  }
  state.projectiles = state.projectiles.filter(p => {
    if (p.userData.dead) { scene.remove(p); return false; }
    return true;
  });
}

function updateTurrets(dt) {
  for (const t of state.turrets) {
    if (t.userData.dead) continue;
    t.userData.cooldown -= dt;

    // HP bar billboard
    if (t.userData.barGroup) {
      t.userData.barGroup.lookAt(camera.position);
      const ratio = Math.max(0, t.userData.hp / t.userData.maxHp);
      t.userData.hpBar.scale.x = ratio;
      const c = ratio > 0.6 ? 0x6ddc9a : ratio > 0.3 ? 0xffc94a : 0xff5d7a;
      t.userData.hpBar.material.color.setHex(c);
    }

    let nearest = null, ndist = Infinity;
    for (const e of state.enemies) {
      const d = t.position.distanceTo(e.position);
      if (d < t.userData.conf.range && d < ndist) { nearest = e; ndist = d; }
    }
    if (nearest) {
      const dir = new THREE.Vector3().subVectors(nearest.position, t.position);
      dir.y = 0;
      t.userData.head.rotation.y = Math.atan2(dir.x, dir.z);

      if (t.userData.cooldown <= 0) {
        const origin = t.position.clone();
        if (t.userData.type === 'missile') {
          // Missile turrets prioritize airborne enemies
          let airTarget = null, airDist = Infinity;
          for (const e of state.enemies) {
            if (e.userData.airborne) {
              const d = t.position.distanceTo(e.position);
              if (d < t.userData.conf.range && d < airDist) { airTarget = e; airDist = d; }
            }
          }
          const target = airTarget || nearest;
          const toTarget = new THREE.Vector3().subVectors(target.position, t.position);
          toTarget.normalize();
          origin.y = 1.4;
          spawnProjectile(origin, toTarget, {
            damage: t.userData.conf.damage,
            color: t.userData.conf.color,
            radius: 0.3,
            homing: true,
            homingTarget: target,
            speed: 18,
          });
        } else {
          origin.y = 1.3;
          dir.normalize();
          spawnProjectile(origin, dir, {
            damage: t.userData.conf.damage,
            color: t.userData.conf.color,
            radius: 0.22,
          });
        }
        t.userData.cooldown = t.userData.conf.cooldown;
      }
    }
  }
  // Remove destroyed turrets from scene
  state.turrets = state.turrets.filter(t => {
    if (t.userData.dead) { scene.remove(t); return false; }
    return true;
  });
}

function updatePickups(dt) {
  for (const p of state.pickups) {
    p.userData.bob += dt * 3;
    p.rotation.y += dt * 0.4;

    // Drift around the room (random change of direction every few seconds)
    if (p.userData.drift) {
      p.userData.driftChangeTimer -= dt;
      if (p.userData.driftChangeTimer <= 0) {
        const ang = Math.random() * Math.PI * 2;
        const sp = 0.9 + Math.random() * 1.2;
        p.userData.drift.x = Math.cos(ang) * sp;
        p.userData.drift.z = Math.sin(ang) * sp;
        p.userData.driftChangeTimer = 2.5 + Math.random() * 2.5;
      }
      p.position.x += p.userData.drift.x * dt;
      p.position.z += p.userData.drift.z * dt;
      // Bounce off room walls
      const lim = ROOM.w / 2 - 2;
      if (p.position.x > lim)  { p.position.x = lim;  p.userData.drift.x = -Math.abs(p.userData.drift.x); }
      if (p.position.x < -lim) { p.position.x = -lim; p.userData.drift.x =  Math.abs(p.userData.drift.x); }
      if (p.position.z > lim)  { p.position.z = lim;  p.userData.drift.z = -Math.abs(p.userData.drift.z); }
      if (p.position.z < -lim) { p.position.z = -lim; p.userData.drift.z =  Math.abs(p.userData.drift.z); }
      // Bounce off bed / nightstand / chest / dresser
      for (const o of OBSTACLES) {
        const halfW = o.w / 2 + 1.0;
        const halfD = o.d / 2 + 1.0;
        const dx = p.position.x - o.x;
        const dz = p.position.z - o.z;
        if (Math.abs(dx) < halfW && Math.abs(dz) < halfD) {
          const overlapX = halfW - Math.abs(dx);
          const overlapZ = halfD - Math.abs(dz);
          if (overlapX < overlapZ) {
            p.position.x = o.x + Math.sign(dx || 1) * halfW;
            p.userData.drift.x = Math.sign(dx || 1) * Math.abs(p.userData.drift.x);
          } else {
            p.position.z = o.z + Math.sign(dz || 1) * halfD;
            p.userData.drift.z = Math.sign(dz || 1) * Math.abs(p.userData.drift.z);
          }
        }
      }
    }

    // Float up/down between roughly 1.2 and 2.6
    p.position.y = 1.9 + Math.sin(p.userData.bob * 0.7) * 0.7;

    // Inner powerup floats and spins inside the bubble
    if (p.userData.inner) {
      p.userData.spin += dt * 2.4;
      p.userData.inner.rotation.y = p.userData.spin;
      p.userData.inner.position.y = Math.sin(p.userData.bob * 1.3) * 0.14;
      p.userData.inner.position.x = Math.cos(p.userData.bob * 0.9) * 0.08;
    }
    // Bubble gently pulses
    if (p.userData.bubble) {
      const s = 1 + Math.sin(p.userData.bob * 1.6) * 0.04;
      p.userData.bubble.scale.set(s, s, s);
    }

    p.userData.life -= dt;
    if (p.userData.life <= 0) p.userData.dead = true;
    // Attract bubble toward Flashy when nearby
    const distToFlashy = p.position.distanceTo(flashy.position);
    if (distToFlashy < 4.5) {
      const pull = new THREE.Vector3().subVectors(flashy.position, p.position).normalize();
      const strength = 4.5 * (1 - distToFlashy / 4.5);
      p.position.addScaledVector(pull, strength * dt);
    }
    if (distToFlashy < 1.8) {
      // Pop the bubble
      spawnDeathPoof(p.position, 0x9be36a);
      spawnHitBurst(p.position, PICKUP_INFO[p.userData.type].color);
      applyPickup(p.userData.type);
      audio.pickup();
      p.userData.dead = true;
    }
  }
  state.pickups = state.pickups.filter(p => {
    if (p.userData.dead) { scene.remove(p); return false; }
    return true;
  });
}

function updateParticles(dt) {
  for (const p of state.particles) {
    if (p.userData.type === 'cloud') {
      p.position.y += p.userData.vy * dt;
      p.scale.multiplyScalar(1 + dt * 0.6);
      p.material.opacity = Math.max(0, p.userData.life * 0.3);
    } else {
      p.position.addScaledVector(p.userData.velocity, dt);
      p.userData.velocity.y -= 14 * dt;
      if (p.userData.fade) p.material.opacity = Math.max(0, p.userData.life);
    }
    p.userData.life -= dt;
    if (p.userData.life <= 0) p.userData.dead = true;
  }
  state.particles = state.particles.filter(p => {
    if (p.userData.dead) { scene.remove(p); return false; }
    return true;
  });
}

function tickWave(dt) {
  if (state.inIntermission) {
    state.intermissionTime -= dt;
    if (state.intermissionTime <= 0) {
      startWave(state.wave + 1);
    }
    return;
  }
  if (state.enemiesToSpawn > 0) {
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      const type = state.currentTypes[Math.floor(Math.random() * state.currentTypes.length)];
      createEnemy(type, state.wave);
      state.enemiesToSpawn--;
      state.spawnTimer = state.spawnInterval;
    }
  } else if (state.enemies.length === 0) {
    endWave();
  }
}

function tickFart(dt) {
  state.fartTimer -= dt;
  if (state.fartTimer <= 0) {
    spawnFartCloud();
    state.fartTimer = 7 + Math.random() * 5; // 7-12s between farts
  }
}

// Orb idle animation
let orbT = 0;
function updateOrb(dt) {
  orbT += dt;
  roomRefs.orb.position.y = ORB_POSITION.y + Math.sin(orbT * 1.6) * 0.12;
  roomRefs.orb.rotation.y += dt * 0.3;
  orbLight.intensity = 2.2 + Math.sin(orbT * 2.5) * 0.25;
}

// ---------- Start ----------
// Pre-fill name input with the last name used
const NAME_KEY = 'fd_player_name';
const nameInput = document.getElementById('player-name');
if (nameInput) nameInput.value = localStorage.getItem(NAME_KEY) || '';

// Fetch global leaderboard, then render. We render immediately too so users
// see local scores while the network call is in flight.
renderHighscores('hs-list-start', 'hs-source-start');
loadGlobalHighscores().then(() => renderHighscores('hs-list-start', 'hs-source-start'));

function tryStart() {
  const name = (nameInput?.value || '').trim();
  if (!name) {
    nameInput.classList.add('error');
    nameInput.focus();
    setTimeout(() => nameInput.classList.remove('error'), 600);
    return;
  }
  state.playerName = name.slice(0, 14);
  localStorage.setItem(NAME_KEY, state.playerName);

  document.getElementById('start-screen').classList.add('hidden');
  state.running = true;
  state.inIntermission = true;
  state.intermissionTime = 8;
  audio.ensure();
  audio.startMusic();
  engageTopDown();
  showMessage(`Good luck, ${state.playerName}! ⏳`, 3);
  updateHUD();
}

document.getElementById('start-btn').addEventListener('click', tryStart);
if (nameInput) {
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') tryStart(); });
}

// ---------- Main loop ----------
const clock = new THREE.Clock();
function animate() {
  const dt = Math.min(0.05, clock.getDelta());
  if (state.running) {
    updatePlayer(dt);
    tickWave(dt);
    tickFart(dt);
    updateEnemies(dt);
    updateProjectiles(dt);
    updateTurrets(dt);
    updatePickups(dt);
    updateParticles(dt);
    updateHUD();
  }
  updateOrb(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

updateHUD();
