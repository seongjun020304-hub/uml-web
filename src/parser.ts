import mermaid from 'mermaid'
import type { ClassDiagram, Diagram, RelationEnd, SequenceBlock, SequenceDiagram, SequenceStep } from './model'

mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })

interface Member {
  getDisplayDetails(): { displayText: string }
}

interface MermaidClass {
  id: string
  label: string
  type: string
  annotations: string[]
  members: Member[]
  methods: Member[]
  styles: string[]
}

interface MermaidClassDb {
  getClasses(): Map<string, MermaidClass>
  getRelations(): {
    id1: string
    id2: string
    title: string
    relationTitle1: string
    relationTitle2: string
    relation: { type1: number; type2: number; lineType: number }
  }[]
}

const ends: readonly RelationEnd[] = ['aggregation', 'inheritance', 'composition', 'dependency', 'lollipop']
const memberText = (member: Member) => member.getDisplayDetails().displayText

function cssColor(value: string) {
  const color = value.trim()
  return /^(?:#[a-f\d]{3,8}|[a-z]+|(?:rgba?|hsla?)\([\d.,%+\s/a-z-]+\))$/i.test(color) &&
    CSS.supports('color', color) ? color : undefined
}

function classModel(db: MermaidClassDb): ClassDiagram {
  const classes = Array.from(db.getClasses().values(), node => {
    const colors: ClassDiagram['classes'][number]['colors'] = {}
    for (const style of node.styles) {
      const [name, value] = style.split(':', 2).map(part => part.trim())
      if (value && (name === 'fill' || name === 'stroke' || name === 'color')) {
        const color = cssColor(value)
        if (color) colors[name] = color
      }
    }
    return {
      id: node.id,
      label: node.type ? `${node.label}<${node.type}>` : node.label,
      annotations: [...node.annotations],
      fields: node.members.map(memberText),
      methods: node.methods.map(memberText),
      colors,
    }
  })
  const occurrences = new Map<string, number>()
  const relations = db.getRelations().map(({ id1, id2, title, relationTitle1, relationTitle2, relation }) => {
    const fromEnd = ends[relation.type1] ?? 'none'
    const toEnd = ends[relation.type2] ?? 'none'
    const dashed = relation.lineType === 1
    const signature = [id1, id2, fromEnd, toEnd, dashed ? 'dashed' : 'solid']
    const key = JSON.stringify(signature)
    const ordinal = occurrences.get(key) ?? 0
    occurrences.set(key, ordinal + 1)
    return {
      id: JSON.stringify([...signature, ordinal]),
      from: id1,
      to: id2,
      fromEnd,
      toEnd,
      dashed,
      label: title,
      fromCardinality: relationTitle1 === 'none' ? '' : relationTitle1,
      toCardinality: relationTitle2 === 'none' ? '' : relationTitle2,
    }
  })
  return { kind: 'class', classes, relations }
}

interface MermaidSequenceDb {
  getActors(): Map<string, { description: string; type: string }>
  getMessages(): { from?: string; to?: string; type?: number; message: unknown; activate?: boolean }[]
  getBoxes(): { name?: string; fill: string; actorKeys: string[] }[]
  getCreatedActors(): Map<string, number>
  getDestroyedActors(): Map<string, number>
  showSequenceNumbers(): boolean
  LINETYPE: Record<'SOLID' | 'DOTTED' | 'ALT_START' | 'ALT_ELSE' | 'ALT_END' | 'LOOP_START' | 'LOOP_END' |
    'OPT_START' | 'OPT_END' | 'BREAK_START' | 'BREAK_END' | 'CRITICAL_START' | 'CRITICAL_OPTION' | 'CRITICAL_END' |
    'RECT_START' | 'RECT_END', number>
}

function sequenceModel(db: MermaidSequenceDb): SequenceDiagram {
  const actors = db.getActors()
  const participants = Array.from(actors, ([id, actor]) => ({ id, label: actor.description }))
  const boxes = db.getBoxes().map(box => ({
    label: box.name ?? '', color: cssColor(box.fill) ?? 'transparent', participants: [...box.actorKeys],
  }))
  const types = db.LINETYPE
  const starts = new Map<number, SequenceBlock['kind']>([
    [types.ALT_START, 'alt'], [types.LOOP_START, 'loop'], [types.OPT_START, 'opt'],
    [types.BREAK_START, 'break'], [types.CRITICAL_START, 'critical'], [types.RECT_START, 'rect'],
  ])
  const ends = new Map<number, SequenceBlock['kind']>([
    [types.ALT_END, 'alt'], [types.LOOP_END, 'loop'], [types.OPT_END, 'opt'],
    [types.BREAK_END, 'break'], [types.CRITICAL_END, 'critical'], [types.RECT_END, 'rect'],
  ])
  let hasUnsupportedDetails = Array.from(actors.values()).some(actor => actor.type !== 'participant') ||
    db.getCreatedActors().size > 0 || db.getDestroyedActors().size > 0 ||
    db.showSequenceNumbers()
  const steps: SequenceStep[] = []
  const blocks: SequenceBlock[] = []
  let messageCount = 0
  for (const { from, to, type, message, activate } of db.getMessages()) {
    const guard = typeof message === 'string' ? message : ''
    const block = blocks.at(-1)
    const current = block?.branches.at(-1)?.steps ?? steps
    const start = type === undefined ? undefined : starts.get(type)
    if (start) {
      const next: SequenceBlock = {
        kind: start, branches: [{ guard: start === 'rect' ? '' : guard, steps: [] }],
        color: start === 'rect' ? cssColor(guard) : undefined,
      }
      current.push(next)
      blocks.push(next)
      continue
    }
    if ((type === types.ALT_ELSE && block?.kind === 'alt') ||
        (type === types.CRITICAL_OPTION && block?.kind === 'critical')) {
      block.branches.push({ guard, steps: [] })
      continue
    }
    if (type !== undefined && block && ends.get(type) === block.kind) {
      blocks.pop()
      continue
    }
    if ((type !== types.SOLID && type !== types.DOTTED) || from === undefined || to === undefined ||
        !actors.has(from) || !actors.has(to) || typeof message !== 'string') {
      hasUnsupportedDetails = true
      continue
    }
    if (activate) hasUnsupportedDetails = true
    current.push({ kind: 'message', from, to, text: message, dashed: type === types.DOTTED })
    messageCount++
  }
  return { kind: 'sequence', participants, boxes, steps, messageCount, hasUnsupportedDetails }
}

export async function parseDiagram(source: string): Promise<Diagram> {
  if (!source.trim()) return { kind: 'class', classes: [], relations: [] }

  const diagram = await mermaid.mermaidAPI.getDiagramFromText(source)
  if (diagram.type === 'class' || diagram.type === 'classDiagram') {
    return classModel(diagram.db as unknown as MermaidClassDb)
  }
  if (diagram.type === 'sequence') {
    return sequenceModel(diagram.db as unknown as MermaidSequenceDb)
  }
  throw new Error('classDiagram 또는 sequenceDiagram 형식의 코드를 입력하세요.')
}
