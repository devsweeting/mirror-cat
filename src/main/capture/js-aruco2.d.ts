// Minimal types for the parts of js-aruco2 (MIT) MirrorCat uses.
declare module 'js-aruco2' {
  export interface ArucoMarker {
    id: number
    /** Clockwise from the marker's own top-left corner, in image pixels. */
    corners: { x: number; y: number }[]
    hammingDistance: number
  }

  export interface ArucoImage {
    width: number
    height: number
    /** RGBA bytes, row-major. */
    data: Uint8ClampedArray | Uint8Array
  }

  /** The package is CommonJS and sets `this.AR`, so ESM only sees a default export. */
  const aruco: { AR: ArucoNamespace }
  export default aruco

  export interface ArucoNamespace {
    Detector: new (config?: { dictionaryName?: string; maxHammingDistance?: number }) => {
      detect(image: ArucoImage): ArucoMarker[]
    }
    Dictionary: new (name: string) => {
      codeList: string[]
      generateSVG(id: number): string
    }
  }
}
