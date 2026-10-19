# Living cave prototype — 19 October 2026

Changes are confined to web/goblin.js, web/goblin.css and tests/goblin.test.js.
Baseline copies and a restore.ps1 script are in .local/goblin-before-atmosphere-20261019.
Run that script in PowerShell and reload to undo the complete experiment. It restores
only those three files, so use it before making further edits to them.

Canvas draws warm/cool light pools, wandering/resting fireflies and a procedural
engineer beside the cabinet. CSS supplies shallow backdrop movement and textured
live text. Existing bats now arrive in groups of 1–3 every 65–120 seconds.
The engineer peeks out around 8–22 seconds into each 48-second active cycle.
No Three.js dependency or new WebGL context is introduced; existing CRT rendering
is unchanged. This is a lightweight visual study, not a reconstructed 3D cave.

The study pauses off-theme/when hidden, caps pixel ratio at 1.5 and runs at up to
25 fps. Reduced motion draws a still composition. Creatures hide during startup
and open dialogs. A local browser switch, localStorage['goblin-atmosphere-v2']='off',
disables Canvas and lettering on reload; use restore.ps1 to restore bats too.

Visual QA remains outstanding: both browser and Node automation runtimes failed
to initialize with 'failed to write kernel assets'. Runtime lifecycle tests cover
visibility, theme switching, reduced motion, rollback switch and page restoration.
The engineer is a provisional drawn character, not final painted sprite artwork.

## Current state after selective revert

The engineer, cave lighting, backdrop movement and experimental bat changes have
been reverted. Enhanced Canvas fireflies and painted sign lettering/splatters are
retained. Original bat timing, flock size and styling are restored. Generated
engineer art is archived in .local/goblin-before-selective-revert-20261019 and is
no longer shipped. Earlier restore scripts describe historical versions only.
103 JavaScript tests pass after the selective revert.
