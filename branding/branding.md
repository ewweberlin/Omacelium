# MeshLLMPlugin — Branding

## 1. Name candidates
1. **Meshd** — short, daemon-like, Arch-culture fit.
2. **Braiding** — mesh imagery, process metaphors.
3. **Loomline** — weaving + network line.
4. **Knotd** — mesh as knot, daemon suffix.
5. **Swarm relay** — descriptive, community framing.

## 2. Recommended
**Loomline** — a loom is literally a mesh-maker; evokes peers weaving inference capacity together, no crypto or corporate connotation, distinct from upstream.

## 3. Taglines (<= 8 words)
1. Weave your GPU into the mesh.
2. Spare cycles, shared inference.
3. Your idle GPU, everyone's model.

## 4. Panel microcopy
- Toggle: **Join mesh** — states: "Mesh on" / "Mesh off"
- Slider: **Contributed load** (percent)
- Endpoints switch: **Local endpoint** (serve agents locally)
- Status strings:
  - joined: "Joined mesh"
  - contributing: "Serving peers"
  - idle: "Standing by"
  - offline: "Offline"
  - no peers: "No peers found"
  - mesh unreachable: "Mesh unreachable"

## 5. Logo concept — 2 directions

### Direction A: "Thread plane"
- **Mark:** a grid of interlocking diagonals forming a rhombus (diamond) lattice, seen as a woven plane tipped in perspective; one strand escapes the lattice and extends past the edge (exit node idea, locally served agents).
- **Geometry:** 4x4 diamond cells, isometric; the escaping strand is one 45-degree polyline with rounded joins. Flat, no gradients.
- **Palette:**
  - Deep slate `#1B2233` (lattice, background)
  - Cyan `#3FD0C9` (active strand)
  - Warm amber `#F2A33C` (escaping strand / accent)

### Direction B: "Node knot"
- **Mark:** five circles (1 center + 4 around) connected by straight edges to each other and the center — a minimal mesh graph in monospace-circle style, the center node filled (your GPU).
- **Geometry:** perfect circle nodes on a square lattice center; edges 2px, nodes 8/14px; center node a filled rounded square to distinguish you vs peers.
- **Palette:**
  - Ink `#22242B`
  - Teal `#2CC4B4`
  - Light gray `#D8DCE2`

## SVG — Direction B (Node knot)
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#1B2233"/>
  <!-- mesh edges -->
  <g stroke="#2CC4B4" stroke-width="2" fill="none">
    <path d="M32 14 L50 32 L32 50 L14 32 Z"/>
    <path d="M32 14 L32 50"/>
    <path d="M14 32 L50 32"/>
  </g>
  <!-- outer peer nodes -->
  <g fill="#2CC4B4">
    <circle cx="32" cy="14" r="5"/>
    <circle cx="50" cy="32" r="5"/>
    <circle cx="32" cy="50" r="5"/>
    <circle cx="14" cy="32" r="5"/>
  </g>
  <!-- your node: rounded square -->
  <rect x="24" y="24" width="16" height="16" rx="4" fill="#F2A33C"/>
</svg>
```

## SVG — Direction A (Thread plane)
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#1B2233"/>
  <g stroke="#3FD0C9" stroke-width="2" fill="none" opacity="0.9">
    <path d="M12 40 L28 24 L44 40 L28 56 Z"/>
    <path d="M20 32 L36 16 L52 32"/>
    <path d="M4 32 L12 40 L20 32"/>
    <path d="M28 8 L12 24 L28 40 L44 24"/>
  </g>
  <!-- escaping accent strand -->
  <path d="M12 56 L28 40 L44 56 L58 44" stroke="#F2A33C" stroke-width="3"
        fill="none" stroke-linecap="round"/>
</svg>
```
