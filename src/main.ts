import example from '../tests/fixtures/01-class-basic.mmd?raw'
import { DiagramCanvas } from './canvas'
import { diagramImage, openMermaidFile, saveFile, writeFile, type ImageFormat } from './files'
import { commentPatch, defaultFontSize, maxFontSize, minFontSize, readLayout, type ColorMode, type LayoutEdit } from './layout'
import type { Diagram } from './model'
import { parseDiagram } from './parser'
import { SequenceCanvas } from './sequence'
import './style.css'

const source = document.querySelector('textarea')!
const error = document.querySelector<HTMLPreElement>('#error')!
const fileError = document.querySelector<HTMLParagraphElement>('#file-error')!
const fileInput = document.querySelector<HTMLInputElement>('#mmd-file')!
const colorMode = document.querySelector<HTMLSelectElement>('#color-mode')!
const imageFormat = document.querySelector<HTMLSelectElement>('#image-format')!
const status = document.querySelector<HTMLOutputElement>('#status')!
const previewTitle = document.querySelector('#preview-title')!
const classView = document.querySelector<HTMLElement>('#class-view')!
const classTools = document.querySelector<HTMLElement>('#class-tools')!
const sequenceView = document.querySelector<HTMLElement>('#sequence-view')!
const sequenceSvg = document.querySelector<SVGSVGElement>('#sequence-canvas')!
const classSvg = document.querySelector<SVGSVGElement>('#canvas')!
const sequenceCanvas = new SequenceCanvas(sequenceSvg, applyEdit)
const fontControl = document.querySelector<HTMLLabelElement>('#font-control')!
const fontSize = document.querySelector<HTMLInputElement>('#font-size')!
fontSize.min = String(minFontSize)
fontSize.max = String(maxFontSize)
let selectedId: string | undefined
let layout = readLayout('')
const canvas = new DiagramCanvas(classSvg, applyEdit, selectClass)
let revision = 0
let timer: number
let openRequest = 0
let fileName = 'diagram'
let documentHandle: FileSystemFileHandle | undefined
let documentId = 0

function showDiagram(model: Diagram, code: string) {
  layout = readLayout(code)
  colorMode.value = layout.colorMode
  for (const view of [classView, sequenceView]) {
    view.classList.toggle('monochrome', layout.colorMode === 'monochrome')
  }
  if (model.kind === 'sequence') {
    canvas.cancelInteraction()
    sequenceCanvas.render(model, layout)
    previewTitle.textContent = '시퀀스 다이어그램'
    status.value = `참여자 ${model.participants.length}명 · 메시지 ${model.messageCount}개`
    if (model.hasUnsupportedDetails) status.value += ' · 일부 문법은 미리보기에 생략됨'
  } else {
    sequenceCanvas.cancelDrag()
    canvas.render(model, layout)
    previewTitle.textContent = '클래스 다이어그램'
    status.value = `클래스 ${model.classes.length}개 · 관계 ${model.relations.length}개`
  }
  classView.hidden = classTools.hidden = model.kind === 'sequence'
  sequenceView.hidden = model.kind !== 'sequence'
  error.hidden = true
  source.removeAttribute('aria-invalid')
}

function refresh() {
  const current = ++revision
  const code = source.value
  window.clearTimeout(timer)
  timer = window.setTimeout(async () => {
    try {
      const model = await parseDiagram(code)
      if (current !== revision) return
      showDiagram(model, code)
    } catch (failure) {
      if (current !== revision) return
      error.textContent = failure instanceof Error ? failure.message : String(failure)
      error.hidden = false
      source.setAttribute('aria-invalid', 'true')
      status.value = '마지막 정상 미리보기'
    }
  }, 150)
}

function applyEdit(edit: LayoutEdit) {
  const { start, end, text } = commentPatch(source.value, edit)
  const scrollTop = source.scrollTop
  const scrollLeft = source.scrollLeft
  source.setRangeText(text, start, end, 'preserve')
  source.scrollTop = scrollTop
  source.scrollLeft = scrollLeft
  if (edit.kind === 'font-size') layout.fontSizes.set(edit.id, edit.value)
  refresh()
}

function selectClass(id: string | undefined) {
  selectedId = id
  fontControl.hidden = id === undefined
  fontSize.value = String((id && layout.fontSizes.get(id)) || defaultFontSize)
}

fontSize.addEventListener('change', () => {
  if (!selectedId) return
  if (!Number.isInteger(fontSize.valueAsNumber) || !fontSize.validity.valid) {
    selectClass(selectedId)
    return
  }
  applyEdit({ kind: 'font-size', id: selectedId, value: fontSize.valueAsNumber })
})
fontSize.addEventListener('keydown', event => {
  if (event.key === 'Enter') fontSize.blur()
})

function reportFileError(action: string, failure: unknown) {
  const message = failure instanceof Error ? failure.message : String(failure)
  fileError.textContent = action + ' 실패. ' + message
  fileError.hidden = false
}

async function openDocument(read: () => Promise<{ file: File; handle?: FileSystemFileHandle } | undefined>) {
  const request = ++openRequest
  const current = revision
  fileError.hidden = true
  try {
    const opened = await read()
    if (!opened || request !== openRequest || current !== revision) return
    const { file, handle } = opened
    const bytes = await file.arrayBuffer()
    let raw: string
    try {
      raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      throw new Error('UTF-8로 인코딩된 .mmd 파일을 선택하세요.')
    }
    const code = raw.replace(/\r\n?/g, '\n')
    if (!code.trim()) throw new Error('파일에 Mermaid 코드가 없습니다.')
    const model = await parseDiagram(code)
    if (request !== openRequest || current !== revision) return
    ++revision
    window.clearTimeout(timer)
    canvas.resetView()
    sequenceCanvas.resetView()
    source.value = code
    fileName = file.name.replace(/\.mmd$/i, '') || 'diagram'
    documentHandle = handle
    documentId++
    showDiagram(model, code)
  } catch (failure) {
    if (request === openRequest && current === revision) reportFileError('파일 열기', failure)
  }
}

document.querySelector('#open-file')!.addEventListener('click', () => {
  void openDocument(async () => {
    const handle = await openMermaidFile(() => fileInput.click())
    if (handle) return { file: await handle.getFile(), handle }
  })
})
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  fileInput.value = ''
  if (file) void openDocument(async () => ({ file }))
})

const saveButton = document.querySelector<HTMLButtonElement>('#save-file')!
const saveAsButton = document.querySelector<HTMLButtonElement>('#save-as')!
async function saveDocument(saveAs: boolean) {
  fileError.hidden = true
  saveButton.disabled = saveAsButton.disabled = true
  const id = documentId
  const blob = new Blob([source.value], { type: 'text/plain;charset=utf-8' })
  try {
    if (documentHandle && !saveAs) {
      await writeFile(documentHandle, blob)
      return
    }
    const target = await saveFile(fileName + '.mmd', 'mmd', () => blob)
    if (!target || id !== documentId) return
    if (target === 'downloaded') {
      documentHandle = undefined
    } else {
      documentHandle = target
      fileName = target.name.replace(/\.mmd$/i, '') || 'diagram'
    }
  } catch (failure) {
    if (id === documentId) {
      const cannotWrite = failure instanceof DOMException &&
        ['NotAllowedError', 'NotFoundError', 'SecurityError'].includes(failure.name)
      reportFileError('파일 저장', cannotWrite && !saveAs
        ? '파일에 쓸 수 없습니다. 다른 이름으로 저장을 선택하세요.'
        : failure)
    }
  } finally {
    saveButton.disabled = saveAsButton.disabled = false
  }
}
saveButton.addEventListener('click', () => void saveDocument(false))
saveAsButton.addEventListener('click', () => void saveDocument(true))

colorMode.addEventListener('change', () => {
  applyEdit({ kind: 'color-mode', id: 'diagram', value: colorMode.value as ColorMode })
})

const exportButton = document.querySelector<HTMLButtonElement>('#export-image')!
exportButton.addEventListener('click', async () => {
  const format = imageFormat.value as ImageFormat
  const code = source.value
  const current = revision
  fileError.hidden = true
  exportButton.disabled = true
  try {
    await saveFile(fileName + (format === 'png' ? '.png' : '.jpg'), format, async () => {
      if (current !== revision) return
      const model = await parseDiagram(code)
      if (current !== revision) return
      showDiagram(model, code)
      const image = await diagramImage(model.kind === 'class' ? classSvg : sequenceSvg, format, layout.colorMode)
      if (current === revision) return image
    })
  } catch (failure) {
    if (current === revision) reportFileError('이미지 내보내기', failure)
  } finally {
    exportButton.disabled = false
  }
})

source.addEventListener('input', refresh)
document.querySelector('#example')!.addEventListener('click', () => {
  source.value = example
  fileName = 'diagram'
  documentHandle = undefined
  documentId++
  refresh()
  source.focus()
})
source.value = 'classDiagram\n  A --> B\n'
refresh()
