# Painted engineer revision

Built-in image generation created `web/goblin-engineer-poses.png`, a transparent
2172 × 724 atlas with four painted poses. `web/goblin.js` uses explicit source
rectangles and preserves the image proportions. Assets are included in the shared
server/build/update manifest. The geometric placeholder has been removed.

First bat flight: 12–20 seconds of visible Goblin mode; subsequent flights:
45–75 seconds after completion. Startup and open dialogs still suppress flights.
Firefly behaviour and CRT rendering are unchanged.

Signs now use bold Caveat lettering, speckled pigment and restrained paint splashes.

Rollback to the previous prototype: run
`.local/goblin-before-sprites-20261019/restore.ps1`, then reload. Restore before
making additional edits to the same files; the script restores four baseline files.
Unused generated artwork is retained.

## Final generation prompt

Use case: stylized-concept. Asset type: transparent game animation sprite atlas. Create ONE wide sheet divided into exactly FOUR equal square cells in a single horizontal row, 4:1 aspect ratio. Each cell contains the SAME detailed charming scruffy goblin television engineer, full body, same size and ground baseline, entirely contained within cell with generous transparent margins, no overlap. Hand-painted 2000s fantasy point-and-click adventure art, textured gouache, fine brushwork, warm earthy olive green skin, expressive long ears and crooked nose, brass goggles on forehead, worn burgundy waistcoat over rolled linen sleeves, patched leather apron with tiny tools, scuffed boots, leather aviator cap. Appealing character with personality, detailed face, NOT geometric, NOT flat vector, NOT pixel art, NOT emoji. Facing three-quarter LEFT toward a TV offscreen. Cell 1: resting standing holding small wrench down. Cell 2: leaning left examining cabinet, wrench slightly raised. Cell 3: reaching left to tighten screw, wrench raised. Cell 4: looking out toward viewer, one hand on goggles. Consistent anatomy, costume, lighting, scale, feet position across all four poses. Warm light from upper left, subtle green rim light. No scenery, no TV, no lettering, no borders, no cell dividers, no ground shadows outside character. Truly transparent background.
