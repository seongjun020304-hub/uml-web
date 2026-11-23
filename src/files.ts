import type { ColorMode } from './layout'
import { svg } from './svg'
import styles from './style.css?inline'

export type ImageFormat = 'png' | 'jpeg'
type SaveFormat = 'mmd' | ImageFormat

const fileTypes = {
  mmd: { description: 'Mermaid', accept: { 'text/plain': ['.mmd'] } },
  png: { description: 'PNG', accept: { 'image/png': ['.png'] } },
  jpeg: { description: 'JPEG', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } },
}

interface FilePickerWindow extends Window {
  showSaveFilePicker?(options: { suggestedName: string; types: typeof fileTypes[SaveFormat][] }): Promise<FileSystemFileHandle>
  showOpenFilePicker?(options: { types: typeof fileTypes.mmd[] }): Promise<FileSystemFileHandle[]>
}

function pickerUnavailable(error: unknown) {
  return error instanceof DOMException && (error.name === 'SecurityError' || error.name === 'NotSupportedError')
}

export async function openMermaidFile(fallback: () => void) {
  const browser = window as FilePickerWindow
  if (window.isSecureContext && typeof browser.showOpenFilePicker === 'function') {
    try {
      const [handle] = await browser.showOpenFilePicker({ types: [fileTypes.mmd] })
      return handle
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (!pickerUnavailable(error)) throw error
    }
  }
  fallback()
}

export async function saveFile(
  name: string,
  format: SaveFormat,
  create: () => Blob | undefined | Promise<Blob | undefined>,
) {
  const browser = window as FilePickerWindow
  let handle: FileSystemFileHandle | undefined
  if (window.isSecureContext && typeof browser.showSaveFilePicker === 'function') {
    try {
      handle = await browser.showSaveFilePicker({ suggestedName: name, types: [fileTypes[format]] })
    } catch (error) {
      if (!(error instanceof DOMException)) throw error
      if (error.name === 'AbortError') return
      if (!pickerUnavailable(error)) throw error
    }
  }

  const blob = await create()
  if (!blob) return
  if (!handle) {
    downloadFile(blob, name)
    return 'downloaded' as const
  }
  await writeFile(handle, blob)
  return handle
}

export async function writeFile(handle: FileSystemFileHandle, blob: Blob) {
  const writer = await handle.createWritable()
  try {
    await writer.write(blob)
    await writer.close()
  } catch (error) {
    await writer.abort().catch(() => {})
    throw error
  }
}

function downloadFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function diagramImage(canvas: SVGSVGElement, format: ImageFormat, mode: ColorMode) {
  const layer = canvas.querySelector<SVGGElement>(':scope > g')!
  const bounds = layer.getBBox()
  if (!bounds.width && !bounds.height) throw new Error('내보낼 다이어그램이 없습니다.')

  const padding = 24
  const width = Math.ceil(bounds.width + padding * 2)
  const height = Math.ceil(bounds.height + padding * 2)
  const scale = Math.min(2, 8192 / Math.max(width, height), Math.sqrt(16_000_000 / (width * height)))
  const raster = document.createElement('canvas')
  raster.width = Math.max(1, Math.floor(width * scale))
  raster.height = Math.max(1, Math.floor(height * scale))
  const context = raster.getContext('2d')
  if (!context) throw new Error('이미지 캔버스를 만들 수 없습니다.')

  const copy = canvas.cloneNode(true) as SVGSVGElement
  copy.querySelector(':scope > g')!.removeAttribute('transform')
  copy.querySelectorAll('.relation-hit, [data-route-id]').forEach(element => element.remove())
  copy.querySelectorAll('.selected').forEach(element => element.classList.remove('selected'))
  copy.setAttribute('viewBox', [bounds.x - padding, bounds.y - padding, width, height].join(' '))
  // The SVG viewport must match the raster size, independently of the editor's responsive CSS.
  copy.style.width = raster.width + 'px'
  copy.style.height = raster.height + 'px'
  copy.style.background = 'transparent'
  copy.setAttribute('width', String(raster.width))
  copy.setAttribute('height', String(raster.height))
  const style = svg('style')
  style.textContent = styles
  copy.prepend(style)

  const svgFile = new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgFile)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    context.fillStyle = '#fff'
    context.fillRect(0, 0, raster.width, raster.height)
    if (mode === 'monochrome') context.filter = 'grayscale(1)'
    context.drawImage(image, 0, 0, raster.width, raster.height)
    return await new Promise<Blob>((resolve, reject) => {
      raster.toBlob(blob => {
        if (blob) resolve(blob)
        else reject(new Error('이미지 파일을 만들 수 없습니다.'))
      }, 'image/' + format, 0.92)
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}
