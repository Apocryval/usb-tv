# Door engineer

Generated using built-in image generation, editing the prior engineer as reference.
Asset: `web/goblin-engineer-door-poses.png`, transparent 2172 × 724 atlas.
Four explicit source rectangles: hand, peek, wrench raised, wrench turned.

The engineer slides from behind the right door's inner edge at 86.4% of the
cabinet width. Canvas clipping conceals the portion behind the door, at full
opacity. Coordinates include the artwork's parallax offset. No legs or floating
full body; lower torso stays concealed. Sequence starts at 4 seconds, reaches,
peeks, works and reverses before retreating at 27 seconds in a 48-second cycle.
Reduced motion shows a still peek. Fireflies, signs and CRT are unchanged.

105 JS tests pass, including source proportions, door occlusion and quiet interval;
four updater tests pass. Atlas visually inspected. Browser screenshot attempt
failed because Edge's GPU process was unusable; scene composition remains to be
confirmed in the running app.

Rollback: `.local/goblin-before-door-20261019/restore.ps1` restores only the three
changed existing files; new artwork is retained unused. Use before further edits.

## Final prompt

Edit reference goblin into a new game sprite atlas. Keep detailed hand-painted fantasy adventure illustration and brass goggles, but make him distinctly GRUMPY and SCRUFFY: deeply furrowed brows, narrowed suspicious eyes, downturned mouth NO smile, patchy grey stubble, greasy untidy hair, torn cap, ragged linen sleeves, stained burgundy waistcoat and leather work apron. FOUR poses in ONE HORIZONTAL ROW of exactly equal-width cells on genuinely transparent background. IMPORTANT consistent scale and registration, no character touching a cell boundary. Show ONLY HEAD AND UPPER TORSO, NO LEGS, character leaning LEFT out from behind an imaginary vertical door edge on his RIGHT. Torso mostly on right half of each cell, head leans left, hand reaches left. Pose1 just dirty left hand reaching around the edge at mid height, rest of character hidden/invisible. Pose2 grumpy head peeking left, hand at same height. Pose3 head and shoulders leaning further left, wrench reaching left to a screw. Pose4 same as pose3 but wrist rotated a little turning wrench. All visible faces are the SAME recognisable character as reference but grumpier older scruffier. No door, no furniture, no background, no text, no grid lines, no shadows outside character. Equal four cells, generous transparent margins. Intended animation: hand appears, head peeks from behind cabinet door, leans to fix control and retracts. Paint beautifully detailed worn textures readable at small size.
