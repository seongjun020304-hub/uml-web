export interface ClassNode {
  id: string
  label: string
  annotations: string[]
  fields: string[]
  methods: string[]
  colors: { fill?: string; stroke?: string; color?: string }
}

export type RelationEnd = 'inheritance' | 'composition' | 'aggregation' | 'dependency' | 'lollipop' | 'none'

export interface Relation {
  id: string
  from: string
  to: string
  fromEnd: RelationEnd
  toEnd: RelationEnd
  dashed: boolean
  label: string
  fromCardinality: string
  toCardinality: string
}

export interface ClassDiagram {
  kind: 'class'
  classes: ClassNode[]
  relations: Relation[]
}

export interface SequenceParticipant {
  id: string
  label: string
}

export interface SequenceMessage {
  kind: 'message'
  from: string
  to: string
  text: string
  dashed: boolean
}

export interface SequenceBlock {
  kind: 'alt' | 'loop' | 'opt' | 'break' | 'critical' | 'rect'
  branches: { guard: string; steps: SequenceStep[] }[]
  color?: string
}

export type SequenceStep = SequenceMessage | SequenceBlock

export interface SequenceDiagram {
  kind: 'sequence'
  participants: SequenceParticipant[]
  boxes: { label: string; color: string; participants: string[] }[]
  steps: SequenceStep[]
  messageCount: number
  hasUnsupportedDetails: boolean
}

export type Diagram = ClassDiagram | SequenceDiagram
