import * as THREE from 'three'
import type { CornerSet } from '@shared/types'

// Subdivisions of the warped mesh. Higher = smoother warp on large/curved
// surfaces at the cost of a few more triangles; 32 is overkill for a flat
// wall and cheap for any GPU from the last decade.
const SEGMENTS = 32

const ROWS = SEGMENTS + 1

/**
 * Writes bilinearly-interpolated vertex positions (in pixels) for the
 * "quad warp" grid into `out`, without allocating a new geometry. Used both
 * to build the initial geometry and to update it in place on every corner
 * drag, since the topology (rows/indices) never changes -- only where the
 * vertices sit.
 */
function writeWarpedPositions(corners: CornerSet, width: number, height: number, out: Float32Array): void {
  const [tl, tr, br, bl] = corners.map((c) => new THREE.Vector2(c.x * width, c.y * height))

  let i3 = 0
  for (let j = 0; j < ROWS; j++) {
    const v = j / SEGMENTS
    const left = tl.clone().lerp(bl, v)
    const right = tr.clone().lerp(br, v)
    for (let i = 0; i < ROWS; i++) {
      const u = i / SEGMENTS
      const point = left.clone().lerp(right, u)
      out[i3++] = point.x
      out[i3++] = point.y
      out[i3++] = 0
    }
  }
}

/**
 * Builds a grid mesh whose four corners sit at the given corner-pin points
 * (in pixels) and whose interior vertices are bilinearly interpolated
 * between them. This is the standard "quad warp" technique projection
 * mapping tools use to fit a rectangular image onto an off-axis or
 * irregular real-world surface.
 */
function buildWarpedGeometry(corners: CornerSet, width: number, height: number): THREE.BufferGeometry {
  const positions = new Float32Array(ROWS * ROWS * 3)
  writeWarpedPositions(corners, width, height, positions)

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
  private texture: THREE.Texture | null = null
  private width = 0
  private height = 0
  private corners: CornerSet
  private frameId: number | null = null
  private resizeObserver: ResizeObserver

  constructor(
    private container: HTMLElement,
    initialCorners: CornerSet
  ) {
    this.corners = initialCorners

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.camera = new THREE.OrthographicCamera(0, 1, 0, 1, -10, 10)

    const geometry = buildWarpedGeometry(this.corners, 1, 1)
    // Dim placeholder fill until real content is generated for this surface.
    const material = new THREE.MeshBasicMaterial({ color: 0x111318 })
    this.mesh = new THREE.Mesh(geometry, material)
    this.scene.add(this.mesh)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()

    this.frameId = requestAnimationFrame(this.renderLoop)
  }

  private renderLoop = (): void => {
    this.renderer.render(this.scene, this.camera)
    this.frameId = requestAnimationFrame(this.renderLoop)
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
  }

  setCorners(corners: CornerSet): void {
    this.corners = corners
    this.rebuildGeometry()
  }

  setTexture(texture: THREE.Texture | null): void {
    const material = this.mesh.material as THREE.MeshBasicMaterial
    if (this.texture) this.texture.dispose()
    this.texture = texture
    material.map = texture
    material.color.set(texture ? 0xffffff : 0x111318)
    material.needsUpdate = true
  }

  // Corner drags and resizes only move existing vertices -- the grid's
  // topology (row count, indices) is fixed by SEGMENTS -- so this writes
  // straight into the existing position attribute instead of disposing and
  // reallocating a whole new BufferGeometry every drag frame.
  private rebuildGeometry(): void {
    if (this.width === 0 || this.height === 0) return
    const position = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute
    writeWarpedPositions(this.corners, this.width, this.height, position.array as Float32Array)
    position.needsUpdate = true
  }

  dispose(): void {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId)
    this.resizeObserver.disconnect()
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.texture?.dispose()
    this.renderer.dispose()
    this.container.removeChild(this.renderer.domElement)
  }
}
