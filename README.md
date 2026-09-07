# THE LAST LIGHT

*Some lights are meant to be carried.*

A short, atmospheric browser adventure. A coastal town went dark at 11:47. You find a
lantern in the road, and the lighthouse is still calling.

**10–15 minutes.** Built with TypeScript, Three.js and Vite. No external assets — every
mesh, texture and sound is generated at runtime.

## Play

```bash
npm install
npm run dev
```

Then open the printed URL.

## Build

```bash
npm run build
npm run preview
```

## Controls

| | |
|---|---|
| `WASD` | move |
| `Shift` | run |
| `Mouse` | look |
| `E` | interact |
| `F` | lantern |
| `Esc` | pause |

## Structure

```
src/
  main.ts            bootstrap
  style.css          UI / title / prompts
  game/
    Game.ts          state machine, story beats, cinematics
    World.ts         the town, station, beach and lighthouse
    Player.ts        stylized character + procedural walk cycle
    CameraRig.ts     third-person camera with damping and pull-in
    Lantern.ts       the lantern, its light and its dust
    Lighting.ts      night sky, moon, IBL environment, light pooling
    Weather.ts       rain, splashes, fog motes, distant lightning
    Memory.ts        the figures the lantern reveals
    Interaction.ts   proximity prompts
    Audio.ts         fully synthesised ambience and music
    UI.ts            overlays
    props.ts         houses, trees, streetlights, street furniture
    textures.ts      canvas-generated textures
    Ocean.ts         shader-animated sea
    util.ts          small helpers
```
