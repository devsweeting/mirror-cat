import * as THREE from 'three'
import type { CornerSet, EdgeNodeSet, SurfaceFit, WarpMode } from '@shared/types'
import { writeWarpGrid } from '@shared/surfaceGeometry'
import { WARP_SEGMENTS } from '@shared/warpPick'
import { MASK_FIELD_RANGE, type SurfaceMask } from '@shared/mask'

// Subdivisions of the warped mesh. Higher = finer warp; edge nodes closer
// together (in content space) than 1/SEGMENTS can't be fully resolved, so
// this is sized well above the per-surface node limit. ~2.4k vertices per
// surface -- trivial for any GPU from the last decade. Shared with mask
// painting, which inverts this exact mesh.
const SEGMENTS = WARP_SEGMENTS

const ROWS = SEGMENTS + 1

const PLACEHOLDER_COLOR = 0x26323d

/** Cells per side of the alignment grid. Even, so there's a center line. */
const GRID_DIVISIONS = 8

/**
 * Alignment grid, drawn in the content's own UV space on the same warped
 * mesh -- so it bends, tilts and foreshortens exactly as the content does.
 * Lines are sized with screen-space derivatives so they stay a constant
 * pixel width however the surface is stretched, with a dark halo so they
 * read over bright content too (on a projector, dark is simply no light).
 *
 * Layers (all hairlines, deliberately subtle): lines every
 * 1/GRID_DIVISIONS, a slightly stronger center cross and border, and faint
 * diagonals. In perspective mode the diagonals cross at
 * the surface's true center, which visibly isn't the midpoint of the shape
 * on screen -- that's the foreshortening at work.
 */
const GRID_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const GRID_FRAGMENT_SHADER = /* glsl */ `
  uniform float uDivisions;
  uniform float uPixelRatio;
  varying vec2 vUv;

  // Coverage of a line of half-width hw (CSS px) at distance d (device px).
  float cover(float d, float hw) {
    float w = hw * uPixelRatio;
    return 1.0 - smoothstep(w - 0.5, w + 0.5, d);
  }

  // Distance in device px from this fragment to the nearest line of
  // f(x, y) = 0 and to the nearest multiple of 1 for g.
  float distTo(float f) { return abs(f) / max(fwidth(f), 1e-6); }
  float distToGrid(float g) {
    return abs(fract(g - 0.5) - 0.5) / max(fwidth(g), 1e-6);
  }

  void main() {
    vec2 uv = vUv;
    float minor = min(distToGrid(uv.x * uDivisions), distToGrid(uv.y * uDivisions));
    float center = min(distTo(uv.x - 0.5), distTo(uv.y - 0.5));
    float border = min(min(distTo(uv.x), distTo(1.0 - uv.x)), min(distTo(uv.y), distTo(1.0 - uv.y)));
    float diag = min(distTo(uv.x - uv.y), distTo(uv.x + uv.y - 1.0));

    // Hairlines, kept quiet so the grid reads as a guide over the content
    // rather than a pattern on top of it. Tune here: half-width (CSS px)
    // and strength per layer, then the halo's extra width and strength.
    const float MINOR_W = 0.4;  const float MINOR_A = 0.3;
    const float DIAG_W = 0.4;   const float DIAG_A = 0.18;
    const float CENTER_W = 0.6; const float CENTER_A = 0.55;
    const float BORDER_W = 0.6; const float BORDER_A = 0.5;
    const float HALO_W = 0.8;   const float HALO_A = 0.35;

    float line = max(
      max(cover(minor, MINOR_W) * MINOR_A, cover(diag, DIAG_W) * DIAG_A),
      max(cover(center, CENTER_W) * CENTER_A, cover(border, BORDER_W) * BORDER_A)
    );
    float halo = max(
      max(cover(minor, MINOR_W + HALO_W) * MINOR_A, cover(diag, DIAG_W + HALO_W) * DIAG_A),
      max(cover(center, CENTER_W + HALO_W) * CENTER_A, cover(border, BORDER_W + HALO_W) * BORDER_A)
    ) * HALO_A;

    float alpha = line + halo * (1.0 - line);
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(vec3(line / alpha), alpha);
  }
`

/**
 * Surface mask, drawn on the same warped mesh between the content and the
 * grid. It outputs only an alpha m, and its blend mode multiplies what's
 * already in this surface's canvas (color *and* alpha) by m -- so masked
 * areas become transparent in the editor and unlit on the projector, with
 * no change to how the content itself is drawn. Each surface has its own
 * canvas, so other surfaces are never touched.
 *
 * The texture is a signed distance field (see shared/mask.ts): 0.5 on the
 * edge. Decoding it gives a distance in "fraction of the shorter side",
 * which grow shifts and feather softens. With no feather the edge is
 * antialiased to about a pixel via fwidth().
 */
const MASK_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uMask;
  uniform float uRange;
  uniform float uGrow;
  uniform float uFeather;
  uniform float uInvert;
  varying vec2 vUv;

  void main() {
    // Mask rows run top-down; the mesh's v is 1 at the top edge.
    float s = texture2D(uMask, vec2(vUv.x, 1.0 - vUv.y)).r;
    float d = (s - 0.5) * 2.0 * uRange;
    d = mix(d, -d, uInvert) + uGrow;
    float edge = max(uFeather * 0.5, fwidth(d) * 0.75);
    float m = smoothstep(-edge, edge, d);
    gl_FragColor = vec4(0.0, 0.0, 0.0, m);
  }
`

/**
 * Builds the warp mesh: a SEGMENTS×SEGMENTS grid with regular UVs, whose
 * vertex positions come from writeWarpGrid (a Coons patch over the
 * surface's corners and edge nodes -- plain bilinear "quad warp" when
 * there are no edge nodes). See docs/surfaces-and-warping.md.
 */
function buildWarpedGeometry(
  corners: CornerSet,
  edgeNodes: EdgeNodeSet,
  warp: WarpMode,
  width: number,
  height: number
): THREE.BufferGeometry {
  const positions = new Float32Array(ROWS * ROWS * 3)
  writeWarpGrid(corners, edgeNodes, SEGMENTS, width, height, positions, warp)

  const uvs: number[] = []
  for (let j = 0; j < ROWS; j++) {
    const v = j / SEGMENTS
    for (let i = 0; i < ROWS; i++) {
      uvs.push(i / SEGMENTS, 1 - v)
    }
  }

  const indices: number[] = []
  for (let j = 0; j < SEGMENTS; j++) {
    for (let i = 0; i < SEGMENTS; i++) {
      const a = j * ROWS + i
      const b = a + 1
      const c = a + ROWS
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  return geometry
}

/**
 * Owns a Three.js renderer/scene/camera for one projection surface. The
 * camera is an orthographic camera sized to the container in pixels, so
 * corner-pin points map 1:1 to on-screen (or on-projector) pixels with no
 * perspective distortion beyond the warp itself.
 */
export class ProjectionEngine {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.OrthographicCamera
  private mesh: THREE.Mesh
  /** Shares `mesh`'s geometry; hidden unless the grid is switched on. */
  private gridMesh: THREE.Mesh
  /** Shares `mesh`'s geometry; hidden unless the surface has a mask. */
  private maskMesh: THREE.Mesh
  private maskMaterial: THREE.ShaderMaterial
  private maskTexture: THREE.Texture | null = null
  /** The mask texture belongs to someone else (the paint canvas); don't dispose it. */
  private maskTextureShared = false
  private warp: WarpMode
  private texture: THREE.Texture | null = null
  private fit: SurfaceFit = 'stretch'
  private width = 0
  private height = 0
  private corners: CornerSet
  private edgeNodes: EdgeNodeSet
  private frameId: number | null = null
  private resizeObserver: ResizeObserver
  /**
   * Chromium allows only ~16 live WebGL contexts per page and silently
   * kills the oldest past that (also on GPU resets and driver updates).
   * Three.js restores its own GL state when the context comes back; we
   * re-upload our geometry and texture and skip drawing while it's gone.
   */
  private contextLost = false
  private disposed = false
  /** The <video> behind the current texture, if it's a video. */
  private video: HTMLVideoElement | null = null

  constructor(
    private container: HTMLElement,
    initialCorners: CornerSet,
    initialEdgeNodes: EdgeNodeSet,
    initialWarp: WarpMode = 'bilinear'
  ) {
    this.corners = initialCorners
    this.edgeNodes = initialEdgeNodes
    this.warp = initialWarp

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    // The canvas is pinned to exactly fill the container in CSS (see
    // .projection-canvas canvas), so its pixel grid lines up 1:1 with the
    // DOM corner handles and outline drawn on top of it.
    this.renderer.domElement.className = 'projection-gl'
    // Prepend, not append: React has already rendered the editor overlay
    // (outline, edge hit-strips, handles) into this container, and the
    // canvas must sit *under* it or it swallows clicks meant for the overlay.
    container.prepend(this.renderer.domElement)
    this.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLost)
    this.renderer.domElement.addEventListener('webglcontextrestored', this.handleContextRestored)

    this.scene = new THREE.Scene()
    this.camera = new THREE.OrthographicCamera(0, 1, 0, 1, -10, 10)

    const geometry = buildWarpedGeometry(this.corners, this.edgeNodes, this.warp, 1, 1)
    // Placeholder fill until real content is generated. Light enough to read
    // as a shape against the pure-black canvas, dark enough not to blast a
    // bright rectangle onto the wall while you're still calibrating.
    const material = new THREE.MeshBasicMaterial({ color: PLACEHOLDER_COLOR, transparent: true })
    this.mesh = new THREE.Mesh(geometry, material)
    this.scene.add(this.mesh)

    const gridMaterial = new THREE.ShaderMaterial({
      vertexShader: GRID_VERTEX_SHADER,
      fragmentShader: GRID_FRAGMENT_SHADER,
      uniforms: {
        uDivisions: { value: GRID_DIVISIONS },
        uPixelRatio: { value: this.renderer.getPixelRatio() }
      },
      transparent: true,
      depthTest: false,
      depthWrite: false
    })
    this.maskMaterial = new THREE.ShaderMaterial({
      vertexShader: GRID_VERTEX_SHADER,
      fragmentShader: MASK_FRAGMENT_SHADER,
      uniforms: {
        uMask: { value: null },
        uRange: { value: MASK_FIELD_RANGE },
        uGrow: { value: 0 },
        uFeather: { value: 0 },
        uInvert: { value: 0 }
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      // result = what's drawn so far × mask alpha, for color and alpha alike.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.SrcAlphaFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.SrcAlphaFactor
    })
    this.maskMesh = new THREE.Mesh(geometry, this.maskMaterial)
    this.maskMesh.renderOrder = 0.5
    this.maskMesh.visible = false
    this.scene.add(this.maskMesh)

    this.gridMesh = new THREE.Mesh(geometry, gridMaterial)
    this.gridMesh.renderOrder = 1
    this.gridMesh.visible = false
    this.scene.add(this.gridMesh)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()

    this.requestRender()
  }

  /**
   * Draw on the next animation frame. Safe to call many times per frame;
   * calls coalesce. Static content draws only when something changes --
   * a full-window redraw 60 times a second per surface was pure GPU load
   * (and fan noise) while calibrating.
   */
  private requestRender = (): void => {
    if (this.frameId === null && !this.disposed) {
      this.frameId = requestAnimationFrame(this.renderFrame)
    }
  }

  private renderFrame = (): void => {
    this.frameId = null
    if (this.contextLost) return
    this.renderer.render(this.scene, this.camera)
    // A playing video changes every frame by itself, so keep going. Paused
    // or finished videos stop; their 'play' / 'seeked' events wake us.
    const video = this.video
    if (video && !video.paused && !video.ended) this.requestRender()
  }

  private handleContextLost = (): void => {
    this.contextLost = true
    console.warn('[engine] WebGL context lost; surface paused until it is restored')
  }

  private handleContextRestored = (): void => {
    this.contextLost = false
    ;(this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    if (this.texture) this.texture.needsUpdate = true
    if (this.maskTexture) this.maskTexture.needsUpdate = true
    this.requestRender()
  }

  resize(): void {
    const { clientWidth, clientHeight } = this.container
    if (clientWidth === 0 || clientHeight === 0) return
    this.width = clientWidth
    this.height = clientHeight
    this.renderer.setSize(clientWidth, clientHeight, false)
    this.camera.left = 0
    this.camera.right = clientWidth
    this.camera.top = 0
    this.camera.bottom = clientHeight
    this.camera.updateProjectionMatrix()
    this.rebuildGeometry()
    this.requestRender()
  }

  setShape(corners: CornerSet, edgeNodes: EdgeNodeSet, warp: WarpMode = this.warp): void {
    this.corners = corners
    this.edgeNodes = edgeNodes
    this.warp = warp
    this.rebuildGeometry()
  }

  /** Show or hide the alignment grid. Independent of content opacity. */
  setGrid(visible: boolean): void {
    if (this.gridMesh.visible === visible) return
    this.gridMesh.visible = visible
    this.requestRender()
  }

  /**
   * Use `texture` (a signed distance field, or a plain black/white image)
   * as this surface's mask, or null for none. The engine takes ownership
   * and disposes it when replaced -- unless `shared` is set, for a texture
   * someone else owns (the live canvas while painting).
   */
  setMaskTexture(texture: THREE.Texture | null, shared = false): void {
    if (this.maskTexture && this.maskTexture !== texture && !this.maskTextureShared) {
      this.maskTexture.dispose()
    }
    this.maskTexture = texture
    this.maskTextureShared = shared
    this.maskMaterial.uniforms.uMask.value = texture
    this.maskMesh.visible = texture !== null
    this.requestRender()
  }

  /** Redraw after a shared mask texture (the paint canvas) changed. */
  maskTextureChanged(): void {
    if (this.maskTexture) this.maskTexture.needsUpdate = true
    this.requestRender()
  }

  setMaskParams({ invert, grow, feather }: Omit<SurfaceMask, 'id'>): void {
    const u = this.maskMaterial.uniforms
    u.uInvert.value = invert ? 1 : 0
    u.uGrow.value = grow
    u.uFeather.value = feather
    this.requestRender()
  }

  setOpacity(opacity: number): void {
    const material = this.mesh.material as THREE.MeshBasicMaterial
    material.opacity = Math.min(1, Math.max(0, opacity))
    this.requestRender()
  }

  /** Largest texture edge this GPU accepts; bigger images render blank. */
  get maxTextureSize(): number {
    return this.renderer.capabilities.maxTextureSize
  }

  setTexture(texture: THREE.Texture | null): void {
    const material = this.mesh.material as THREE.MeshBasicMaterial
    if (this.texture) this.texture.dispose()
    this.watchVideo(
      texture instanceof THREE.VideoTexture ? (texture.image as HTMLVideoElement) : null
    )
    this.texture = texture
    material.map = texture
    material.color.set(texture ? 0xffffff : PLACEHOLDER_COLOR)
    material.needsUpdate = true
    this.applyFit()
    this.requestRender()
  }

  setFit(fit: SurfaceFit): void {
    this.fit = fit
    this.applyFit()
    this.requestRender()
  }

  /** Redraw continuously while this video plays, and once after a seek. */
  private watchVideo(video: HTMLVideoElement | null): void {
    if (this.video === video) return
    if (this.video) {
      this.video.removeEventListener('play', this.requestRender)
      this.video.removeEventListener('seeked', this.requestRender)
    }
    this.video = video
    if (video) {
      video.addEventListener('play', this.requestRender)
      video.addEventListener('seeked', this.requestRender)
    }
  }

  /**
   * `fill` crops the texture (via UV repeat/offset) so the image keeps its
   * proportions on the surface. The surface's aspect is estimated from its
   * corner-to-corner edge lengths in on-screen pixels -- edge nodes bend the
   * edges but rarely change the overall proportions much.
   */
  private applyFit(): void {
    const texture = this.texture
    if (!texture) return
    texture.repeat.set(1, 1)
    texture.offset.set(0, 0)
    if (this.fit !== 'fill' || this.width === 0 || this.height === 0) return

    // Images and canvases report width/height; a <video>'s width/height are
    // its layout attributes (0 when detached), so use videoWidth/Height.
    const source = texture.image as {
      width?: number
      height?: number
      videoWidth?: number
      videoHeight?: number
    } | null
    const w = source?.videoWidth || source?.width || 0
    const h = source?.videoHeight || source?.height || 0
    const imageAspect = w && h ? w / h : 0
    const [tl, tr, br, bl] = this.corners.map((c) => ({
      x: c.x * this.width,
      y: c.y * this.height
    }))
    const across = Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)
    const down = Math.hypot(bl.x - tl.x, bl.y - tl.y) + Math.hypot(br.x - tr.x, br.y - tr.y)
    const surfaceAspect = down > 0 ? across / down : 0
    if (imageAspect <= 0 || surfaceAspect <= 0) return

    if (imageAspect > surfaceAspect) {
      const r = surfaceAspect / imageAspect
      texture.repeat.x = r
      texture.offset.x = (1 - r) / 2
    } else {
      const r = imageAspect / surfaceAspect
      texture.repeat.y = r
      texture.offset.y = (1 - r) / 2
    }
  }

  // Corner drags and resizes only move existing vertices -- the grid's
  // topology (row count, indices) is fixed by SEGMENTS -- so this writes
  // straight into the existing position attribute instead of disposing and
  // reallocating a whole new BufferGeometry every drag frame.
  private rebuildGeometry(): void {
    if (this.width === 0 || this.height === 0) return
    const position = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute
    writeWarpGrid(
      this.corners,
      this.edgeNodes,
      SEGMENTS,
      this.width,
      this.height,
      position.array as Float32Array,
      this.warp
    )
    position.needsUpdate = true
    // The surface's proportions just changed, so a `fill` crop must too.
    if (this.fit === 'fill') this.applyFit()
    this.requestRender()
  }

  dispose(): void {
    this.disposed = true
    if (this.frameId !== null) cancelAnimationFrame(this.frameId)
    this.frameId = null
    this.watchVideo(null)
    this.resizeObserver.disconnect()
    const canvas = this.renderer.domElement
    canvas.removeEventListener('webglcontextlost', this.handleContextLost)
    canvas.removeEventListener('webglcontextrestored', this.handleContextRestored)
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    ;(this.gridMesh.material as THREE.Material).dispose()
    this.maskMaterial.dispose()
    if (!this.maskTextureShared) this.maskTexture?.dispose()
    this.maskTexture = null
    this.texture?.dispose()
    this.texture = null
    this.renderer.dispose()
    // renderer.dispose() frees GPU resources but not the context itself,
    // which otherwise lingers until garbage collection. Adding/removing
    // surfaces (and StrictMode's double mount in dev) would pile contexts
    // up until Chromium starts killing live ones.
    this.renderer.forceContextLoss()
    canvas.remove()
  }
}
