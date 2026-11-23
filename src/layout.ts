export interface Point { x: number; y: number }

export const defaultFontSize = 15
export const minFontSize = 8
export const maxFontSize = 72

export interface Layout {
  positions: Map<string, Point>
  fontSizes: Map<string, number>
  routes: Map<string, Point[]>
  colorMode: ColorMode
}

export type ColorMode = 'color' | 'monochrome'
export type LayoutEdit =
  | { kind: 'layout'; id: string; value: Point }
  | { kind: 'font-size'; id: string; value: number }
  | { kind: 'route'; id: string; value: Point[] }
  | { kind: 'color-mode'; id: 'diagram'; value: ColorMode }

const comment = /^([ \t]*%%[ \t]*@(layout|font-size|route|color-mode)[ \t]+)("(?:\\.|[^"\\])*"|\[.*\]|\S+)([ \t]+)(\S(?:.*?\S)?)([ \t]*)$/
const relationEnds = new Set(['inheritance', 'composition', 'aggregation', 'dependency', 'lollipop', 'none'])

function readComment(line: string) {
  const match = comment.exec(line)
  if (!match) return
  const [, prefix, kind, token, gap, body, suffix] = match
  let id = token
  try {
    if (kind === 'route') {
      const parts: unknown = JSON.parse(token)
      if (!Array.isArray(parts) || parts.length !== 6) return
      const [from, to, fromEnd, toEnd, style, ordinal] = parts
      if (typeof from !== 'string' || typeof to !== 'string' ||
          !relationEnds.has(fromEnd) || !relationEnds.has(toEnd) ||
          (style !== 'solid' && style !== 'dashed') || !Number.isSafeInteger(ordinal) || ordinal < 0) return
      id = JSON.stringify(parts)
    } else if (token.startsWith('"')) {
      const parsed: unknown = JSON.parse(token)
      if (typeof parsed !== 'string' || !parsed) return
      id = parsed
    }
  } catch {
    return
  }

  const leading = prefix + token + gap
  if (kind === 'color-mode') {
    if (id !== 'diagram' || (body !== 'color' && body !== 'monochrome')) return
    const edit: LayoutEdit = { kind, id, value: body }
    return { edit, leading, suffix }
  }
  const tokens = body.split(/\s+/)
  if (tokens.some(token => !/^-?\d+$/.test(token))) return
  const numbers = tokens.map(Number)
  if (!numbers.every(Number.isSafeInteger)) return

  let edit: LayoutEdit
  if (kind === 'font-size') {
    if (numbers.length !== 1 || numbers[0] < minFontSize || numbers[0] > maxFontSize) return
    edit = { kind, id, value: numbers[0] }
  } else if (kind === 'layout') {
    if (numbers.length !== 2) return
    edit = { kind, id, value: { x: numbers[0], y: numbers[1] } }
  } else {
    if (numbers.length % 2) return
    const value: Point[] = []
    for (let index = 0; index < numbers.length; index += 2) {
      value.push({ x: numbers[index], y: numbers[index + 1] })
    }
    edit = { kind: 'route', id, value }
  }
  return { edit, leading, suffix }
}

export function readLayout(source: string): Layout {
  const layout: Layout = { positions: new Map(), fontSizes: new Map(), routes: new Map(), colorMode: 'color' }
  let colorRead = false
  for (const line of source.split('\n')) {
    const comment = readComment(line)
    if (!comment) continue
    const { edit } = comment
    switch (edit.kind) {
      case 'layout':
        if (!layout.positions.has(edit.id)) layout.positions.set(edit.id, edit.value)
        break
      case 'font-size':
        if (!layout.fontSizes.has(edit.id)) layout.fontSizes.set(edit.id, edit.value)
        break
      case 'route':
        if (!layout.routes.has(edit.id)) layout.routes.set(edit.id, edit.value)
        break
      case 'color-mode':
        if (!colorRead) layout.colorMode = edit.value
        colorRead = true
        break
    }
  }
  return layout
}

export function commentPatch(source: string, edit: LayoutEdit) {
  const body = edit.kind === 'layout' ? [edit.value.x, edit.value.y].join(' ')
    : edit.kind === 'route' ? edit.value.flatMap(point => [point.x, point.y]).join(' ')
    : String(edit.value)
  const token = edit.kind === 'route' || /^[^"\s]\S*$/.test(edit.id) ? edit.id : JSON.stringify(edit.id)
  let offset = 0
  let insertion = 0
  for (const line of source.split('\n')) {
    const managed = readComment(line)
    if (managed?.edit.kind === edit.kind && managed.edit.id === edit.id) {
      return { start: offset + managed.leading.length, end: offset + line.length - managed.suffix.length, text: body }
    }
    if (managed || (!insertion && /^\s*(?:classDiagram(?:-v2)?|sequenceDiagram)\b/.test(line))) insertion = offset + line.length
    offset += line.length + 1
  }

  const line = '%% @' + edit.kind + ' ' + token + ' ' + body
  const text = insertion ? '\n' + line : line + '\n'
  return { start: insertion, end: insertion, text }
}
