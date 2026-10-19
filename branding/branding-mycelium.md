# Omacelium — Mycelium rebrand (supersedes earlier logo directions; name unchanged)

Name **Omacelium** reads natively as fungus-themed (mycelium), which is the whole mesh metaphor: a decentralized, anonymous network of organisms sharing nutrients — here, GPUs sharing inference. Keep `community.omacelium`.

## Taglines (<= 8 words)
1. Bloom your GPU into the mesh.
2. Spore up, share inference.
3. One hypha at a time, whole capacity.

## Panel microcopy (unchanged strings, fungus flavor only where noted)
- Toggle: **Join mesh** — "Mesh on" / "Mesh off" (optional flavor: "Fruiting" / "Dormant" — pick one pair, don't mix)
- Slider: **Contributed load** (percent)
- Switch: **Local endpoint**
- Status: "Joined mesh", "Serving peers", "Standing by", "Offline", "No peers found", "Mesh unreachable"

## Logo — direction C: "Hyphal node"
- **Mark:** branching hyphae — rooting threads that fork outward inorganic 2-fork pattern — growing from a filled rounded-square center node ("your GPU"); small dots (spores) sit at the tips and a few mid-hypha junctions. Flat, no gradients.
- **Geometry:** on a rounded-square badge; hyphae stroked 2.5px, rounded caps, branching at 30-60 degrees; 4 spores r=3.5, sparse. Reads as mesh at small size because forks meet like graph edges.
- **Palette (loam chair):**
  - Loam bark `#241E2E` (badge background)
  - Pale beige `#E7DCC8` (hyphae)
  - Amber spore `#F2A33C` (spores + center node)

## SVG — Hyphal node
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#241E2E"/>
  <g stroke="#E7DCC8" stroke-width="2.5" fill="none" stroke-linecap="round">
    <path d="M32 44 L32 32 L24 22"/>
    <path d="M32 32 L40 22"/>
    <path d="M24 22 L18 14"/>
    <path d="M40 22 L46 14"/>
    <path d="M32 44 L20 48"/>
    <path d="M32 44 L44 48"/>
  </g>
  <g fill="#F2A33C">
    <circle cx="18" cy="14" r="3.5"/>
    <circle cx="46" cy="14" r="3.5"/>
    <circle cx="24" cy="22" r="3.5"/>
    <circle cx="40" cy="22" r="3.5"/>
    <circle cx="20" cy="48" r="3.5"/>
    <circle cx="44" cy="48" r="3.5"/>
  </g>
  <rect x="27" y="39" width="10" height="10" rx="3" fill="#F2A33C"/>
</svg>
```
