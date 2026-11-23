export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, number | string> = {}) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value))
  return element
}

export function addText(parent: SVGElement, value: string, x: number, y: number, style: string) {
  const text = svg('text', { x, y, class: style })
  text.textContent = value
  parent.append(text)
  return text
}
