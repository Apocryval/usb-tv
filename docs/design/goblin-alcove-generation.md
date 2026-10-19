# Goblin cave alcove artwork

Created with the built-in image-generation tool. Final workspace assets:
- web/goblin-cabinet-tv.png
- web/goblin-document.png
- web/goblin-scroll-1.png
- web/goblin-scroll-2.png
- web/goblin-scroll-3.png

The cabinet is a non-destructive sibling of goblin-cabinet.png. A CSS silhouette clips its painted outer backdrop; no bitmap processing was applied. Live video fits the illustrated CRT glass. Paper images use CSS nine-slice borders. The wooden sign instead uses the original artwork with contain sizing, so its nails and grain retain their proportions.

Caveat is bundled from https://github.com/google/fonts/tree/main/ofl/caveat with its OFL licence in web/caveat-license.txt. Downloaded font: https://raw.githubusercontent.com/google/fonts/main/ofl/caveat/Caveat%5Bwght%5D.ttf .

## Prompts

### Cabinet TV (edit, reference web/goblin-cabinet.png)
Edit this front-facing goblincore cabinet asset. Preserve cabinet silhouette, broken left door half off hinges, absent door knobs, moss and scuffs. Put an OLD CRT TELEVISION physically INSIDE its central hollow, resting on the cabinet bottom shelf. TV has chunky dirty olive/brown plastic casing, convex glass screen, small speaker grille and mechanical tuning dials on the RIGHT. Single large blank BLACK screen rectangle approximately x=330 to 1090, y=300 to 740 on 1536x1024 canvas, for live video overlay. Keep screen straight-on, no perspective skew. Screen glass corner radius subtle. The television occupies central hollow, does not overlap doors. No text, no pictures playing. Remove outer brown background: outside cabinet silhouette fully transparent. The cabinet should look like an object standing in a cave, no solid rectangular background. Detailed hand-painted 2000s Flash adventure-game asset. Same 3:2 canvas.

### Summary document
Standalone hand-painted old cream parchment DOCUMENT game UI asset, portrait ratio 4:5. Empty central area for real HTML handwriting, absolutely NO text NO symbols NO writing. Irregular torn paper edges, slightly curling top and bottom corners, subtle crease lines and coffee/earth stains near edges, warm ivory centre spacious and bright, papyrus fibres, small worn holes near corners, darkened ochre edges. Flat front-facing 2D 2000s Flash fantasy adventure inventory art, painterly raster, crisp readable blank central 75%. Fully transparent background outside paper silhouette. No pins, wood, moss, frame or objects.

### Strip 1
Standalone blank weathered CREAM PARCHMENT horizontal programme-strip game UI asset. Wide horizontal rectangle ratio 6:1. Flat front view, aged ivory paper with faint papyrus fibres, hand-painted dark ochre worn edges, small irregular tears and subtly curled short left/right ends. Blank large central area for HTML text NO lettering NO text NO symbols. Edge decoration confined to outermost 4% on left/right and 10% top/bottom, centre light and almost uniform. 2000s Flash fantasy adventure game interface art. Fully transparent outside ragged silhouette. No rods, nails, wood, shadows outside. This must be suitable for a horizontally resizable 9-slice UI strip.

### Strip 2
Wide blank horizontal parchment strip for fantasy Flash game UI, ratio 6:1. Cream ivory thin paper with a dog-eared upper right corner and shallow missing chip lower left, faint folds, subtly darker tea-stained ragged edges. Blank light centre NO text NO symbols. Edge details only outermost 4% left/right and 10% top/bottom. Flat front-facing isolated transparent background. No rods or objects. Suitable for 9-slice resizing, hand-painted adventure game art.

### Strip 3
Wide blank horizontal parchment strip for fantasy Flash game UI, ratio 6:1. Warm pale cream papyrus, two small edge nicks, frayed lower right corner, fine fibrous texture, slightly rolled short ends. Spacious bright blank centre NO text NO symbols. Edge details only outermost 4% left/right and 10% top/bottom. Flat front-facing isolated transparent background. No rods or objects. Suitable for 9-slice resizing, hand-painted adventure game art.

## Validation

Isolated synthetic desktop and 390px iframe previews checked in browser. Measured desktop plaques: all 238x108px despite deliberately long ON NOW titles. Programme slot thresholds checked at 210px (full details), 80px (title only), 24px (no text). Full titles remain available through the existing real-app tooltip/focus details. No duration/clock calculation changed. Summary text no longer has a rounding-induced scrollbar. Screenshots: .local/goblin-ui/alcove-scrolls-preview.png and alcove-mobile-proof.png.

## Stone footing follow-up

Generated with the built-in image tool and saved as web/goblin-stone-shelf.png. CSS places its flat top against the cabinet feet, with a contact shadow. Existing SVG intro goblin reused as the small header mascot; CSS blink and bob animations stop under reduced motion. The two main navigation tabs reuse the original wooden plaque at its native proportions. Channel lettering now uses a warm painted-ochre treatment, smaller type, generous line spacing, no clipping/clamping box, and no downward text offset. Exact reported names verified at desktop and 390px. Source fixture proof: .local/goblin-ui/footing-header-preview.png; mobile: footing-mobile-proof.png.

Stone shelf prompt:
Transparent game UI environment asset, a low broad CAVE ROCK SHELF pedestal for a battered wooden television cabinet to stand on. Wide horizontal ratio 4:1. Flat top stone ledge running from x10% to90%, viewed slightly from above with heavy jagged rock face below, weathered slate and limestone muted grey brown olive, sparse moss at edges, a few small mushrooms low at corners. Hand-painted detailed 2000s Flash goblincore adventure game art. Large clean fairly horizontal top edge near upper third for cabinet feet; stone base fills lower half. Fully transparent outside rock silhouette. No cabinet, no television, no text, no furniture, no large background scene. Soft dark contact shadow along centre top.
