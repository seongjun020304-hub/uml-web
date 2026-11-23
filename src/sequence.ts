import type { SequenceDiagram, SequenceStep } from './model'
import { addText, svg } from './svg'
import { CanvasViewport, svgPoint } from './viewport'
import type { Layout, LayoutEdit, Point } from './layout'

const margin = 32
const headHeight = 44
const headBottom = margin + headHeight
const messageGap = 52
const frameInset = 12
const guardHeight = 28
const guardOffset = 68
const selfWidth = 34
const selfLabelOffset = 42

type Gesture =
  | { kind: 'participant'; pointer: number; id: string; offset: number; initial: number; minimum: number }
  | { kind: 'pan'; pointer: number; previous: Point }

export class SequenceCanvas {
  private readonly measure = document.createElement('canvas').getContext('2d')!
  private readonly positions = new Map<string, number>()
  private readonly layer = svg('g')
  private readonly view = new CanvasViewport(this.layer)
  private diagram?: SequenceDiagram
  private drag?: Gesture

  constructor(private readonly canvas: SVGSVGElement, private readonly onEdit: (edit: LayoutEdit) => void) {
    canvas.append(this.layer)
    canvas.addEventListener('wheel', event => {
      const cursor = this.view.zoom(event, canvas)
      if (!cursor || !this.drag) return
      if (this.drag.kind === 'pan') this.drag.previous = cursor
      else this.moveParticipant(event, this.drag)
    }, { passive: false })
    canvas.addEventListener('pointerdown', event => {
      if (event.target !== canvas || event.button !== 0 || this.drag) return
      this.startDrag(event, { kind: 'pan', pointer: event.pointerId, previous: svgPoint(event, canvas) })
    })
    canvas.addEventListener('pointermove', event => {
      const drag = this.drag
      if (drag?.pointer !== event.pointerId) return
      if (drag.kind === 'participant') this.moveParticipant(event, drag)
      else {
        const cursor = svgPoint(event, canvas)
        this.view.pan(drag.previous, cursor)
        drag.previous = cursor
      }
    })
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      canvas.addEventListener(type, event => {
        const drag = this.drag
        if (drag?.pointer !== event.pointerId) return
        if (drag.kind === 'participant' && type === 'pointerup') this.commitPosition(event, drag)
        this.cancelDrag()
      })
    }
  }

  cancelDrag() {
    const drag = this.drag
    if (!drag) return
    this.drag = undefined
    this.canvas.classList.remove('sequence-dragging')
    if (this.canvas.hasPointerCapture(drag.pointer)) this.canvas.releasePointerCapture(drag.pointer)
  }

  resetView() {
    this.cancelDrag()
    this.view.reset()
  }

  render(diagram: SequenceDiagram, layout: Layout) {
    this.cancelDrag()
    this.diagram = diagram
    this.positions.clear()
    for (const { id } of diagram.participants) {
      const position = layout.positions.get(id)
      if (position) this.positions.set(id, position.x)
    }
    this.paint()
  }

  private startDrag(event: PointerEvent, drag: Gesture) {
    event.preventDefault()
    this.drag = drag
    this.canvas.setPointerCapture(event.pointerId)
    this.canvas.classList.add('sequence-dragging')
  }

  private moveParticipant(event: MouseEvent, drag: Extract<Gesture, { kind: 'participant' }>) {
    this.positions.set(drag.id, Math.max(drag.minimum, svgPoint(event, this.layer).x - drag.offset))
    this.paint()
  }

  private commitPosition(event: PointerEvent, drag: Extract<Gesture, { kind: 'participant' }>) {
    const x = Math.round(Math.max(drag.minimum, svgPoint(event, this.layer).x - drag.offset))
    if (x !== Math.round(drag.initial)) {
      this.positions.set(drag.id, x)
      this.onEdit({ kind: 'layout', id: drag.id, value: { x, y: margin } })
    } else if (this.positions.get(drag.id) !== undefined) {
      this.positions.set(drag.id, drag.initial)
    }
    this.paint()
  }

  private paint() {
    const diagram = this.diagram!
    const defs = svg('defs')
    const arrow = svg('marker', {
      id: 'sequence-arrow', viewBox: '0 0 10 10', markerWidth: 10, markerHeight: 10,
      refX: 9, refY: 5, orient: 'auto', markerUnits: 'userSpaceOnUse',
    })
    arrow.append(svg('path', { d: 'M 0 0 L 9 5 L 0 10 Z', fill: 'currentColor' }))
    defs.append(arrow)
    const heads = svg('g')
    const events = svg('g')
    const lifelines = svg('g')
    const groups = svg('g')
    const highlights = svg('g')
    const lanes = new Map<string, number>()
    const headWidths = new Map<string, number>()

    this.measure.font = '600 15px system-ui'
    const widths = diagram.participants.map(({ label }) =>
      Math.max(116, Math.ceil(this.measure.measureText(label).width + 32)))
    this.measure.font = '14px system-ui'
    let maxDepth = 0
    let gap = 68
    const measureSteps = (steps: SequenceStep[], depth: number) => {
      for (const step of steps) {
        if (step.kind === 'message') {
          if (step.from !== step.to) gap = Math.max(gap, this.measure.measureText(step.text).width + 24)
        } else {
          maxDepth = Math.max(maxDepth, depth + 1)
          for (const branch of step.branches) {
            measureSteps(branch.steps, depth + 1)
          }
        }
      }
    }
    measureSteps(diagram.steps, 0)
    const side = margin + maxDepth * frameInset
    let x = side
    for (const [index, participant] of diagram.participants.entries()) {
      const headWidth = widths[index]
      const saved = this.positions.get(participant.id)
      const left = saved ?? x
      const center = left + headWidth / 2
      lanes.set(participant.id, center)
      headWidths.set(participant.id, headWidth)
      const head = svg('g', { 'data-participant-id': participant.id, class: 'sequence-participant' })
      head.append(svg('rect', { x: left, y: margin, width: headWidth, height: headHeight, rx: 7 }))
      addText(head, participant.label, center, margin + 27, 'sequence-participant-label')
      head.addEventListener('pointerdown', event => {
        if (event.button !== 0 || this.drag) return
        this.startDrag(event, {
          kind: 'participant', pointer: event.pointerId, id: participant.id,
          offset: svgPoint(event, this.layer).x - left, initial: left, minimum: Math.min(side, left),
        })
      })
      heads.append(head)
      x += headWidth + gap
    }

    let y = headBottom + 20
    const renderSteps = (steps: SequenceStep[], parent: SVGGElement) => {
      let left = Infinity
      let right = -Infinity
      for (const step of steps) {
        if (step.kind === 'message') {
          const from = lanes.get(step.from)!
          const to = lanes.get(step.to)!
          const text = this.measure.measureText(step.text)
          y += Math.max(messageGap, text.actualBoundingBoxAscent + 24)
          const row = svg('g', { class: 'sequence-message', 'data-from': step.from, 'data-to': step.to })
          const self = from === to
          const labelX = self ? from + selfLabelOffset : (from + to) / 2
          const textStart = self ? labelX : labelX - text.width / 2
          const d = self ? `M ${from} ${y - 15} h ${selfWidth} v 15 H ${to}` : `M ${from} ${y} H ${to}`
          const path = svg('path', { d, fill: 'none', class: 'sequence-arrow', 'marker-end': 'url(#sequence-arrow)' })
          if (step.dashed) path.setAttribute('stroke-dasharray', '6 4')
          row.append(path)
          addText(row, step.text, labelX, y - 9,
            self ? 'sequence-message-label self' : 'sequence-message-label')
          parent.append(row)
          left = Math.min(left, from, to, textStart - Math.max(0, text.actualBoundingBoxLeft) - 2)
          right = Math.max(right, from, to, self ? from + selfWidth : to,
            textStart + Math.max(text.width, text.actualBoundingBoxRight) + 2)
          y += Math.max(0, text.actualBoundingBoxDescent - 7)
          continue
        }

        const group = svg('g', { class: 'sequence-block', 'data-block': step.kind })
        const top = y + 16
        if (step.kind === 'rect') {
          const background = svg('rect', { class: 'sequence-highlight', fill: step.color ?? 'transparent' })
          highlights.append(background)
          y = top
          const bounds = renderSteps(step.branches[0].steps, group)
          const rectLeft = (Number.isFinite(bounds.left) ? bounds.left : side) - frameInset
          const rectRight = Number.isFinite(bounds.right) ? bounds.right + frameInset : rectLeft + frameInset * 2
          y += frameInset
          background.setAttribute('x', String(rectLeft))
          background.setAttribute('y', String(top))
          background.setAttribute('width', String(rectRight - rectLeft))
          background.setAttribute('height', String(y - top))
          left = Math.min(left, rectLeft)
          right = Math.max(right, rectRight)
          parent.append(group)
          continue
        }
        let innerLeft = Infinity
        let innerRight = -Infinity
        let headerWidth = 0
        const headers: { y: number; baseline: number; guard: string }[] = []
        const branchKeyword = step.kind === 'critical' ? 'option' : 'else'
        for (const [index, branch] of step.branches.entries()) {
          y = index === 0 ? top : y + 16
          const guard = this.measure.measureText(branch.guard)
          const baseline = Math.max(19, guard.actualBoundingBoxAscent + 6)
          headers.push({ y, baseline, guard: branch.guard })
          headerWidth = Math.max(headerWidth, guardOffset + Math.max(guard.width, guard.actualBoundingBoxRight) + frameInset)
          y += Math.max(guardHeight, baseline + guard.actualBoundingBoxDescent + 8)
          const body = svg('g', { class: 'sequence-branch' })
          const bounds = renderSteps(branch.steps, body)
          innerLeft = Math.min(innerLeft, bounds.left)
          innerRight = Math.max(innerRight, bounds.right)
          group.append(body)
        }
        const frameLeft = (Number.isFinite(innerLeft) ? innerLeft : side) - frameInset
        const frameRight = Math.max(innerRight + frameInset, frameLeft + headerWidth)
        y += frameInset + 4
        group.prepend(svg('rect', { class: 'sequence-frame', x: frameLeft, y: top, width: frameRight - frameLeft, height: y - top }))
        for (const [index, header] of headers.entries()) {
          if (index > 0) group.append(svg('line', {
            class: 'sequence-' + branchKeyword, x1: frameLeft, x2: frameRight, y1: header.y, y2: header.y,
          }))
          addText(group, index === 0 ? step.kind : branchKeyword, frameLeft + 10, header.y + header.baseline, 'sequence-block-keyword')
          addText(group, header.guard, frameLeft + guardOffset, header.y + header.baseline, 'sequence-guard')
        }
        left = Math.min(left, frameLeft)
        right = Math.max(right, frameRight)
        parent.append(group)
      }
      return { left, right }
    }
    renderSteps(diagram.steps, events)

    const height = y + messageGap
    for (const box of diagram.boxes) {
      const ids = box.participants.filter(id => lanes.has(id))
      if (!ids.length) continue
      const left = Math.min(...ids.map(id => lanes.get(id)! - headWidths.get(id)! / 2)) - 12
      const right = Math.max(...ids.map(id => lanes.get(id)! + headWidths.get(id)! / 2)) + 12
      const width = Math.max(right - left, this.measure.measureText(box.label).width + 24)
      const group = svg('g', { class: 'sequence-group' })
      group.append(svg('rect', { x: left, y: 4, width, height: height - 8, rx: 5, fill: box.color }))
      addText(group, box.label, left + width / 2, 23, 'sequence-group-label')
      groups.append(group)
    }
    for (const center of lanes.values()) {
      lifelines.append(svg('line', {
        class: 'sequence-lifeline', x1: center, x2: center, y1: headBottom, y2: height - 20,
      }))
    }
    this.layer.replaceChildren(defs, groups, highlights, lifelines, heads, events)
  }
}
