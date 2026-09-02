# Agents Commander — Classic Blue pixel identity

Updated 2026-09-02. The approved mark reads `>/<`: two opposing pixel prompts
with a forward slash between them. Original Atari/Commodore-era software
inspiration, without reproducing either company's trademark.

- [Square mark](logo.png): README, landing-page navigation/favicon/hero and
  conference deck.
- [Wordmark lockup](logo-wordmark.png): the same mark beside the two-line
  **AGENTS / COMMANDER** pixel lettering, for wider promotional applications.
- `landing-page/logo.png` and `landing-page/logo-wordmark.png` are exact copies
  for the standalone GitHub Pages directory.

## Colour and usage

The palette follows the terminal's **Classic Blue** theme: blue background,
cyan chevrons and lettering, yellow slash. Generation targets are `#0000AA`,
`#55FFFF` and `#FFFF55` respectively. The terminal uses ANSI colour names, so
its exact displayed colours depend on the user's terminal palette; the PNGs
are generated raster masters, not a guarantee of exact flat pixel values.

Both assets have an **opaque blue background**, not transparency. Preserve
their aspect ratio and clear space; never stretch the square mark into the
wordmark's frame. On the website, use square corners and pixelated rendering
for the icon. Check the small navigation/favicon sizes as well as the hero.
The terminal's ASCII title, website's green-phosphor theme and presentation's
Callstack styling remain independent and unchanged.

These are raster assets, not hand-hinted bitmap fonts or editable vectors.
The earlier navy/periwinkle square-cursor logo and the old mascot remain
recoverable in git history. No claim of trademark clearance is made.

## Generation provenance

Created with the **built-in image-generation tool**; no CLI/API fallback.
The user selected the pixel `>/<` concept, then the Classic Blue colourway.
The square mark is the approved colour preview, copied without alteration.
The wordmark was updated from the previous lockup with the approved mark as
its second reference. Only these two final assets are shipped.

Final square-mark colour prompt (edit of the approved navy `>/<` concept):

> Use case: precise-object-edit.
> Asset type: Agents Commander pixel logo colour preview.
> Input image 1 is the edit target. Change ONLY the colours and remove any texture/soft shading, preserving the exact >/< glyph shapes, forward-slash direction, scale, spacing, pixel steps, centered position and square composition.
> Primary request: recolour this logo to match the classic old-school blue/cyan/yellow terminal UI of Agents Commander, with an authentic 1980s/1990s text-mode software feel.
> Colour palette: replace the entire cream background with one perfectly uniform deep DOS blue #0000AA. Recolour BOTH outer chevrons > and < to solid bright cyan #55FFFF. Recolour the central forward slash / to solid bright warm terminal yellow #FFFF55. These are the only three colours, aside from unavoidable raster edge antialiasing. No white or cream background. No navy chevrons. No periwinkle slash.
> Constraints: exact symbol >/<, three separate glyphs with their existing visible gaps, bold crisp squared pixel edges, identical geometry to reference, large clean blue negative space. One logo mark only. No words, letters, labels, palette swatches, extra symbols, border, terminal-window frame, mockup, gradients, glow, shadows, scanlines, bevels, perspective or texture. Flat, minimal, highly legible, retro digital.

Final wordmark prompt (old lockup as image 1, approved colour mark as image 2):

> Use case: precise-object-edit.
> Asset type: Agents Commander horizontal pixel-logo wordmark for the repository and promotional materials.
> Input image 1 is the old wordmark EDIT TARGET. Input image 2 is the user-approved replacement logo and strict shape/colour reference.
> Update image 1 to the new identity: replace the old > square < emblem with the precise pixel >/< mark from image 2. Cyan mirrored outer chevrons and a yellow forward slash rising from bottom-left to top-right. Keep the three glyphs distinct and recognisable.
> Replace the entire off-white background with a flat uniform deep DOS blue #0000AA. Recolour all AGENTS / COMMANDER lettering bright cyan #55FFFF. Slash yellow #FFFF55. Preserve the existing bold pixel typography, exact spelling, two-line arrangement and overall horizontal lockup, with emblem at left and words at right.
> Exact text on two lines: "AGENTS" then "COMMANDER". No other text.
> Make the icon visually balanced with the two-line type block and vertically center them. Compact even outer padding about 5%, wide approximately 3:1 canvas. Crisp square pixel geometry, flat solid colours, no texture, gradients, soft glow, shadows, bevels, rounded letter corners, borders, mockup, checkerboard or other brand symbols. This is an opaque blue-background logo, not transparent.

The prompts record intent; actual geometry, padding and colour are defined by
the checked-in PNGs. Always visually verify the image at its final display size.
