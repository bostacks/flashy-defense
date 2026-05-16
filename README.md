# 🦥 Flashy Defense

A browser-based tower-defense / action RPG set inside a 10-year-old's bedroom at night — built with Three.js and zero build steps.

![Game screenshot placeholder](https://img.shields.io/badge/Three.js-r160-black?logo=three.js) ![No build step](https://img.shields.io/badge/build-none-brightgreen) ![Web Audio](https://img.shields.io/badge/audio-Web%20Audio%20API-blueviolet)

---

## Story

Chelsea, age 10, is fast asleep. Her sassy older sister — **the Sassinator** — has unleashed her evil twin stuffies **Skyler & Honey** and their plush minions to steal Chelsea's **Orb of Power** (a moon nightlight, but shhh).

Only **Flashy, the Mighty Sloth**, stands between the stuffies and the orb.

---

## Gameplay

- **Tower defense + action RPG hybrid** — you control Flashy directly while also placing turrets
- Survive **6 waves** of increasingly fast, large, and tanky stuffed-animal enemies
- **Wave 3+** introduces parachuting stuffies that drop from the ceiling
- Earn **sparkles** by defeating enemies and spend them on turrets
- Chelsea farts in her sleep every so often — grab the power-up bubble that floats out from the bed

---

## Controls

| Key | Action |
|-----|--------|
| `WASD` | Move Flashy |
| `Mouse` | Aim |
| `Left Click` | Shoot foam dart |
| `T` | Toggle turret placement mode |
| `1 / 2 / 3 / 4` | Switch turret type |
| `V` | Cycle camera (first-person → top-down → over-shoulder) |
| `Space` | Hop (for style) |
| `M` | Mute / un-mute |

---

## Turrets

| # | Name | Cost | Damage | Cooldown | Range | Notes |
|---|------|------|--------|----------|-------|-------|
| 1 | **Dart** (Bear) | free | 15 | 0.38s | 10 | Unlocked from wave 1 |
| 2 | **Bubble** (Frog) | 50 ✨ | 28 | 0.55s | 11 | Unlocks wave 2 |
| 3 | **Marshmallow** (Unicorn) | 75 ✨ | 55 | 0.85s | 13 | Unlocks wave 4 |
| 4 | **Missile** (Rocket Plush) | 100 ✨ | 40 | 1.1s | 16 | Unlocks wave 3 — homing, prioritises airborne enemies |

Turrets are built to look like stuffed animals: the bear holds a foam dart, the frog shoots bubbles from its mouth, the unicorn fires from its glowing horn, and the rocket plane fires homing missiles.

---

## Enemies

| Enemy | Description |
|-------|-------------|
| **Minions** | Random stuffed-animal species (bear, bunny, cat, frog, pig, duck, dragon, penguin) |
| **Skyler** | Blue bunny — fast, tough |
| **Honey** | Yellow bear — slow, very tanky |
| **Sassinator** | Giant evil pink unicorn boss |
| **Parachute stuffies** | Drop from y=12 with a colored canopy; become ground enemies on landing |

All enemies scale each wave: **+13% speed**, **+9% size**, **+25% HP** per wave.

---

## Power-ups

Grabbed by walking into the fart bubble (it floats toward you when you're nearby):

| Power-up | Effect |
|----------|--------|
| ⚡ Rapid Fire | 8 seconds of near-instant fire rate |
| 💥 Big Damage | 10 seconds of 40-damage shots |
| 🎯 Triple Shot | 10 seconds of 3-way spread fire |
| ❤️ Heal | +50 HP |
| ✨ Sparkles | +30 sparkles |

---

## Tech

- **[Three.js r160](https://threejs.org/)** via CDN import map — no bundler, no npm, no build step
- **Web Audio API** — all music and SFX synthesised in code (no audio files)
  - Action chiptune: 150 BPM, I–vi–IV–V loop, square melody + triangle bass + synthesised drums
  - Fart SFX: 2+ seconds of layered sawtooth + filtered noise with sputter bursts
- **Pointer Lock API** for first-person and over-shoulder camera modes
- **AABB collision** keeps Flashy out of furniture
- Homing missile projectiles use velocity `lerp` toward their target each frame
- Parachute canopies built from Three.js hemisphere geometry with stripe overlays

### Run locally

```bash
# Any static file server works — Python is the easiest:
python3 -m http.server 8765
# then open http://localhost:8765
```

No installation required.

---

## Project structure

```
flashy-defense/
├── index.html   # HUD, screens, Three.js import map
├── style.css    # Dark purple/pink night theme
└── game.js      # Everything else (~2600 lines, single ES module)
```

---

## License

MIT — do whatever you want with it, just don't steal Chelsea's nightlight.
