import type { Point } from './layout'

export function svgPoint(event: MouseEvent, coordinates: SVGGraphicsElement): Point {
  return new DOMPoint(event.clientX, event.clientY).matrixTransform(coordinates.getScreenCTM()!.inverse())
}

export class CanvasViewport {
  private offset: Point = { x: 0, y: 0 }
  private scale = 1

  constructor(private readonly layer: SVGGElement) {}

  zoom(event: WheelEvent, canvas: SVGSVGElement): Point | undefined {
    event.preventDefault()
    const wheelUnit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1
    const scale = Math.max(0.2, Math.min(4, this.scale * Math.exp(-event.deltaY * wheelUnit * 0.002)))
    if (scale === this.scale) return

    const cursor = svgPoint(event, canvas)
    const ratio = scale / this.scale
    this.offset.x = cursor.x - (cursor.x - this.offset.x) * ratio
    this.offset.y = cursor.y - (cursor.y - this.offset.y) * ratio
    this.scale = scale
    this.apply()
    return cursor
  }

  pan(previous: Point, cursor: Point) {
    this.offset.x += cursor.x - previous.x
    this.offset.y += cursor.y - previous.y
    this.apply()
  }

  reset() {
    this.offset = { x: 0, y: 0 }
    this.scale = 1
    this.layer.removeAttribute('transform')
  }

  private apply() {
    const { x, y } = this.offset
    this.layer.setAttribute('transform', 'translate(' + x + ' ' + y + ') scale(' + this.scale + ')')
  }
}
