import { addText, svg } from './svg'
import { CanvasViewport, svgPoint } from './viewport'
import type { ClassDiagram, ClassNode, Relation, RelationEnd } from './model'
import { defaultFontSize, type Layout, type LayoutEdit, type Point } from './layout'

interface Box extends Point { width: number; height: number }
interface Drag {
  pointer: number
  start: Point
  initial: Point
  target: Point
  update: () => void
  commit: () => void
  finish?: () => void
}

const cornerRadius = 7

const markers: Partial<Record<RelationEnd, { path: string; fill: string }>> = {
  dependency: { path: 'M 1 1 L 11 7 L 1 13', fill: 'none' },
  inheritance: { path: 'M 1 1 L 11 7 L 1 13 Z', fill: 'var(--paper)' },
  composition: { path: 'M 0 7 L 5.5 2 L 11 7 L 5.5 12 Z', fill: 'currentColor' },
  aggregation: { path: 'M 0 7 L 5.5 2 L 11 7 L 5.5 12 Z', fill: 'var(--paper)' },
  lollipop: { path: 'M 11 7 A 5 5 0 1 1 1 7 A 5 5 0 1 1 11 7 Z', fill: 'var(--paper)' },
}

function classBox(node: ClassNode, box: Box, fontSize: number) {
  const group = svg('g', {
    class: 'node', 'data-class-id': node.id, 'aria-label': node.label, role: 'button', tabindex: 0,
  })
  group.style.setProperty('--class-font-size', fontSize + 'px')
  for (const [name, color] of Object.entries(node.colors)) {
    group.style.setProperty('--class-' + name, color)
  }
  group.append(svg('rect', { width: box.width, height: box.height, rx: cornerRadius }))
  const row = Math.ceil(fontSize * 1.4)
  let y = 10 + fontSize
  for (const annotation of node.annotations) {
    addText(group, '«' + annotation + '»', box.width / 2, y, 'annotation')
    y += row
  }
  addText(group, node.label, box.width / 2, y, 'node-label')
  y += row
  for (const compartment of [node.fields, node.methods]) {
    if (!compartment.length) continue
    const divider = y - fontSize
    group.append(svg('line', { x1: 0, x2: box.width, y1: divider, y2: divider }))
    y += 8
    for (const member of compartment) {
      addText(group, member, 14, y, 'member')
      y += row
    }
  }
  return group
}

const center = (box: Box): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })

function border(box: Box, toward: Point, fallback: number): Point {
  const origin = center(box)
  const dx = toward.x - origin.x
  const dy = toward.y - origin.y
  if (!dx && !dy) return { x: origin.x + fallback * box.width / 2, y: origin.y }

  const length = Math.hypot(dx, dy)
  const ux = Math.abs(dx) / length
  const uy = Math.abs(dy) / length
  const halfWidth = box.width / 2
  const halfHeight = box.height / 2
  let distance = Math.min(halfWidth / ux, halfHeight / uy)
  const cornerX = halfWidth - cornerRadius
  const cornerY = halfHeight - cornerRadius
  if (distance * ux > cornerX && distance * uy > cornerY) {
    const projection = cornerX * ux + cornerY * uy
    const perpendicular = cornerX * uy - cornerY * ux
    distance = projection + Math.sqrt(Math.max(0, cornerRadius ** 2 - perpendicular ** 2))
  }
  return { x: origin.x + Math.sign(dx) * ux * distance, y: origin.y + Math.sign(dy) * uy * distance }
}

function routePoints(from: Box, to: Box, bends: Point[]): Point[] {
  const points = bends.length || from !== to ? bends : [
    { x: from.x + from.width + 24, y: from.y + from.height / 2 },
    { x: from.x + from.width + 24, y: from.y - 24 },
    { x: from.x + from.width / 2, y: from.y - 24 },
  ]
  return [
    border(from, points[0] ?? center(to), 1),
    ...points,
    border(to, points.at(-1) ?? center(from), -1),
  ]
}

function nearestSegment(points: Point[], click: Point) {
  let closest = { index: 0, point: points[0], distance: Infinity }
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index]
    const end = points[index + 1]
    const dx = end.x - start.x
    const dy = end.y - start.y
    const projection = ((click.x - start.x) * dx + (click.y - start.y) * dy) / (dx ** 2 + dy ** 2 || 1)
    const ratio = Math.max(0, Math.min(1, projection))
    const point = { x: start.x + ratio * dx, y: start.y + ratio * dy }
    const distance = (click.x - point.x) ** 2 + (click.y - point.y) ** 2
    if (distance < closest.distance) closest = { index, point, distance }
  }
  return closest
}

function translate(group: SVGGElement, point: Point) {
  group.setAttribute('transform', 'translate(' + point.x + ' ' + point.y + ')')
}

export class DiagramCanvas {
  private boxes = new Map<string, Box>()
  private drag?: Drag
  private pan?: { pointer: number; previous: Point }
  private pendingRender?: { diagram: ClassDiagram; layout: Layout }
  private selected?: string
  private newBend?: { relation: string; index: number; point: Point }
  private readonly viewport = svg('g')
  private readonly view = new CanvasViewport(this.viewport)
  private nodes = svg('g')
  private edges = svg('g', { class: 'edges' })
  private handles = svg('g')
  private updateEdges: (() => void)[] = []
  private readonly measure = document.createElement('canvas').getContext('2d')!

  constructor(
    private readonly canvas: SVGSVGElement,
    private readonly onEdit: (edit: LayoutEdit) => void,
    private readonly onSelection: (id: string | undefined) => void,
  ) {
    const defs = svg('defs')
    for (const [name, shape] of Object.entries(markers)) {
      const marker = svg('marker', {
        id: name, viewBox: '0 0 12 14', markerWidth: 12, markerHeight: 14,
        refX: 11, refY: 7, orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse',
      })
      marker.append(svg('path', { d: shape.path, fill: shape.fill, stroke: 'currentColor', 'stroke-width': 1.5 }))
      defs.append(marker)
    }
    this.viewport.append(this.edges, this.nodes, this.handles)
    canvas.append(defs, this.viewport)
    canvas.addEventListener('wheel', event => this.zoom(event), { passive: false })
    canvas.addEventListener('pointerdown', event => {
      if (event.target !== canvas || event.button !== 0 || this.drag || this.pan) return
      event.preventDefault()
      this.select(undefined)
      this.pan = { pointer: event.pointerId, previous: this.point(event, this.canvas) }
      canvas.setPointerCapture(event.pointerId)
      canvas.classList.add('dragging')
    })
    canvas.addEventListener('pointermove', event => {
      if (this.drag?.pointer === event.pointerId) this.move(event, this.drag)
      if (this.pan?.pointer === event.pointerId) this.moveView(event, this.pan)
    })
    canvas.addEventListener('pointerup', event => {
      if (this.drag?.pointer === event.pointerId) {
        this.move(event, this.drag)
        this.finishDrag(true)
      } else if (this.pan?.pointer === event.pointerId) {
        this.moveView(event, this.pan)
        this.finishPan(event.pointerId)
      }
    })
    for (const type of ['pointercancel', 'lostpointercapture'] as const) {
      canvas.addEventListener(type, event => {
        if (this.drag?.pointer === event.pointerId) this.finishDrag(false)
        if (this.pan?.pointer === event.pointerId) this.finishPan(event.pointerId)
      })
    }
  }

  cancelInteraction() {
    this.finishDrag(false)
    if (this.pan) this.finishPan(this.pan.pointer)
    this.select(undefined)
  }

  resetView() {
    this.cancelInteraction()
    this.view.reset()
  }

  render(diagram: ClassDiagram, layout: Layout) {
    if (this.drag) {
      this.pendingRender = { diagram, layout }
      return
    }
    this.nodes.replaceChildren()
    this.edges.replaceChildren()
    this.handles.replaceChildren()
    this.boxes.clear()
    this.updateEdges = []
    const entries = diagram.classes.map(node => {
      const fontSize = layout.fontSizes.get(node.id) ?? defaultFontSize
      return { node, fontSize, ...this.classSize(node, fontSize) }
    })
    for (const { node, width, height } of entries) {
      const fixed = layout.positions.get(node.id)
      if (fixed) this.boxes.set(node.id, { ...fixed, width, height })
    }
    let slot = 0
    const stepX = Math.max(132, ...entries.map(entry => entry.width)) + 90
    const stepY = Math.max(44, ...entries.map(entry => entry.height)) + 80
    for (const [index, { node, width, height, fontSize }] of entries.entries()) {
      let box = this.boxes.get(node.id)
      if (!box) {
        let candidateSlot = index
        while (true) {
          const candidate = { x: 44 + candidateSlot % 3 * stepX, y: 62 + Math.floor(candidateSlot / 3) * stepY, width, height }
          const overlaps = [...this.boxes.values()].some(other =>
            candidate.x < other.x + other.width + 24 && candidate.x + width + 24 > other.x &&
            candidate.y < other.y + other.height + 24 && candidate.y + height + 24 > other.y)
          if (overlaps) {
            candidateSlot = entries.length + slot++
            continue
          }
          box = candidate
          break
        }
        this.boxes.set(node.id, box)
      }
      const position = box
      const group = classBox(node, position, fontSize)
      translate(group, position)
      group.addEventListener('pointerdown', event => {
        if (event.button !== 0 || this.drag || this.pan) return
        group.focus({ preventScroll: true })
        this.select(node.id)
        this.startDrag(event, position, () => translate(group, position), () => {
          this.onEdit({ kind: 'layout', id: node.id, value: position })
        })
      })
      group.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        this.select(node.id)
      })
      this.nodes.append(group)
    }
    for (const relation of diagram.relations) {
      const from = this.boxes.get(relation.from)
      const to = this.boxes.get(relation.to)
      if (from && to) this.drawRelation(relation, from, to, layout.routes.get(relation.id) ?? [])
    }
    this.updateEdges.forEach(update => update())
    this.select(this.selected && this.boxes.has(this.selected) ? this.selected : undefined)
  }

  private classSize(node: ClassNode, fontSize: number) {
    this.measure.font = '600 ' + fontSize + 'px system-ui'
    const titleWidth = this.measure.measureText(node.label).width
    this.measure.font = fontSize + 'px monospace'
    const sections = [node.fields, node.methods].filter(section => section.length)
    const lines = [...node.annotations.map(value => '«' + value + '»'), ...sections.flat()]
    const contentWidth = Math.max(titleWidth, ...lines.map(value => this.measure.measureText(value).width))
    const rows = 1 + lines.length
    return {
      width: Math.max(132, Math.ceil(contentWidth + 28)),
      height: 20 + rows * Math.ceil(fontSize * 1.4) + sections.length * 8,
    }
  }

  private drawRelation(relation: Relation, from: Box, to: Box, route: Point[]) {
    const bends = route.map(point => ({ ...point }))
    const line = svg('path', { class: 'relationship', fill: 'none', 'data-relation-id': relation.id })
    const hit = svg('path', { class: 'relation-hit', fill: 'none' })
    if (relation.dashed) line.setAttribute('stroke-dasharray', '6 4')
    if (relation.fromEnd !== 'none') line.setAttribute('marker-start', 'url(#' + relation.fromEnd + ')')
    if (relation.toEnd !== 'none') line.setAttribute('marker-end', 'url(#' + relation.toEnd + ')')
    this.edges.append(line, hit)
    const label = addText(this.edges, relation.label ?? '', 0, 0, 'relation-label')
    const fromLabel = addText(this.edges, relation.fromCardinality ?? '', 0, 0, 'relation-label')
    const toLabel = addText(this.edges, relation.toCardinality ?? '', 0, 0, 'relation-label')
    const knots = svg('g', { 'data-route-id': relation.id })
    this.handles.append(knots)
    const save = () => this.onEdit({ kind: 'route', id: relation.id, value: bends })
    const update = () => {
      const points = routePoints(from, to, bends)
      const d = 'M ' + points.map(point => point.x + ' ' + point.y).join(' L ')
      line.setAttribute('d', d)
      hit.setAttribute('d', d)
      if (label.textContent) {
        const middle = line.getPointAtLength(line.getTotalLength() / 2)
        label.setAttribute('x', String(middle.x))
        label.setAttribute('y', String(middle.y - 9))
      }
      const placeCardinality = (text: SVGTextElement, start: Point, next: Point) => {
        text.setAttribute('x', String(start.x + (next.x - start.x) * 0.15))
        text.setAttribute('y', String(start.y + (next.y - start.y) * 0.15 + 16))
      }
      placeCardinality(fromLabel, points[0], points[1])
      placeCardinality(toLabel, points[points.length - 1], points[points.length - 2])
    }
    const drawHandles = () => {
      knots.replaceChildren()
      for (const [index, bend] of bends.entries()) {
        const knob = svg('circle', { class: 'bend-handle', r: 6, cx: bend.x, cy: bend.y })
        const pending = this.newBend
        const isNew = pending?.relation === relation.id && pending.index === index &&
          pending.point.x === bend.x && pending.point.y === bend.y
        knob.classList.toggle('placing', isNew)
        knob.addEventListener('pointermove', () => {
          if (!this.drag && !this.pan) knob.classList.add('hovered')
        })
        knob.addEventListener('pointerleave', () => knob.classList.remove('hovered'))
        knob.addEventListener('pointerdown', event => {
          if (event.button !== 0 || this.drag || this.pan) return
          if (isNew) this.newBend = undefined
          knob.classList.remove('placing', 'hovered')
          knob.classList.add('moving')
          this.startDrag(event, bend, () => {
            knob.setAttribute('cx', String(bend.x))
            knob.setAttribute('cy', String(bend.y))
          }, save, () => knob.classList.remove('moving'))
        })
        knots.append(knob)
      }
    }
    hit.addEventListener('dblclick', event => {
      const points = routePoints(from, to, bends)
      const { index, point } = nearestSegment(points, this.point(event))
      if (from === to && !bends.length) {
        bends.push(...points.slice(1, -1).map(point => ({ x: Math.round(point.x), y: Math.round(point.y) })))
      }
      const position = { x: Math.round(point.x), y: Math.round(point.y) }
      bends.splice(index, 0, position)
      this.handles.querySelector('.placing')?.classList.remove('placing')
      this.newBend = { relation: relation.id, index, point: { ...position } }
      drawHandles()
      update()
      save()
    })
    drawHandles()
    this.updateEdges.push(update)
  }

  private select(id: string | undefined) {
    this.selected = id
    for (const node of this.nodes.children) {
      const selected = node.getAttribute('data-class-id') === id
      node.classList.toggle('selected', selected)
      node.setAttribute('aria-pressed', String(selected))
    }
    this.onSelection(id)
  }

  private point(event: MouseEvent, coordinates: SVGGraphicsElement = this.viewport): Point {
    return svgPoint(event, coordinates)
  }

  private zoom(event: WheelEvent) {
    const cursor = this.view.zoom(event, this.canvas)
    if (!cursor) return
    if (this.drag) this.move(event, this.drag)
    if (this.pan) this.pan.previous = cursor
  }

  private moveView(event: PointerEvent, pan: { previous: Point }) {
    const cursor = this.point(event, this.canvas)
    this.view.pan(pan.previous, cursor)
    pan.previous = cursor
  }

  private finishPan(pointer: number) {
    this.pan = undefined
    this.canvas.classList.remove('dragging')
    if (this.canvas.hasPointerCapture(pointer)) this.canvas.releasePointerCapture(pointer)
  }

  private startDrag(event: PointerEvent, target: Point, update: () => void, commit: () => void, finish?: () => void) {
    event.preventDefault()
    this.drag = { pointer: event.pointerId, start: this.point(event), initial: { x: target.x, y: target.y }, target, update, commit, finish }
    this.canvas.setPointerCapture(event.pointerId)
    this.canvas.classList.add('dragging')
  }

  private move(event: MouseEvent, drag: Drag) {
    const point = this.point(event)
    drag.target.x = drag.initial.x + point.x - drag.start.x
    drag.target.y = drag.initial.y + point.y - drag.start.y
    drag.update()
    this.updateEdges.forEach(update => update())
  }

  private finishDrag(commit: boolean) {
    const drag = this.drag
    if (!drag) return
    this.drag = undefined
    this.canvas.classList.remove('dragging')
    if (this.canvas.hasPointerCapture(drag.pointer)) this.canvas.releasePointerCapture(drag.pointer)
    drag.target.x = commit ? Math.round(drag.target.x) : drag.initial.x
    drag.target.y = commit ? Math.round(drag.target.y) : drag.initial.y
    drag.update()
    drag.finish?.()
    this.updateEdges.forEach(update => update())
    const moved = drag.target.x !== drag.initial.x || drag.target.y !== drag.initial.y
    const pending = this.pendingRender
    this.pendingRender = undefined
    if (moved && commit) drag.commit()
    if (pending && !(moved && commit)) this.render(pending.diagram, pending.layout)
  }
}
