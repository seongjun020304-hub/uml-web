import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const readFixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}.mmd`, import.meta.url), 'utf8')
const example = readFixture('01-class-basic')
const invalid = readFixture('08-error-class')
const basic = 'classDiagram\n  A --> B\n'

test('renders the class fixture and keeps it visible on a syntax error', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '예제 불러오기' }).click()
  const editor = page.getByRole('textbox', { name: 'Mermaid 코드' })
  await expect(editor).toHaveValue(example.replace(/\r\n/g, '\n'))
  const animal = page.locator('[data-class-id="Animal"]')
  const dog = page.locator('[data-class-id="Dog"]')
  const edge = page.locator('.relationship')
  await expect(animal).toContainText('+String name')
  await expect(animal).toContainText('+eat(food) : void')
  await expect(animal).toHaveAttribute('transform', 'translate(120 80)')
  await expect(dog).toBeVisible()
  await expect(edge).toHaveCount(1)
  await expect(edge).toHaveAttribute('marker-start', 'url(#inheritance)')
  const previousPath = await edge.getAttribute('d')
  await editor.fill(invalid)
  await expect(page.getByRole('alert')).toContainText(/line|parse/i)
  await expect(editor).toHaveAttribute('aria-invalid', 'true')
  await expect(animal).toBeVisible()
  await expect(dog).toBeVisible()
  await expect(edge).toHaveAttribute('d', previousPath!)
  await editor.fill(basic)
  await expect(page.getByRole('alert')).toBeHidden()
  await expect(page.locator('[data-class-id="A"]')).toBeVisible()
})

test('updates the edge during drag and retains manual coordinates after parsing edits', async ({ page }) => {
  await page.goto('/')
  const editor = page.getByRole('textbox', { name: 'Mermaid 코드' })
  await editor.fill(basic)
  const a = page.locator('[data-class-id="A"]')
  const edge = page.locator('.relationship')
  await expect(page.locator('.node')).toHaveCount(2)
  await expect(edge).toHaveCount(1)
  await expect(edge).toHaveAttribute('marker-end', 'url(#dependency)')
  const original = await edge.getAttribute('d')
  const bounds = (await a.boundingBox())!
  await page.mouse.move(bounds.x + 45, bounds.y + 20)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 95, bounds.y + 155, { steps: 5 })
  await expect(edge).not.toHaveAttribute('d', original!)
  const endpoint = await edge.evaluate((path: SVGPathElement) => {
    const { x, y } = path.getPointAtLength(0)
    return { x, y }
  })
  const position = await a.evaluate((group: SVGGElement) => {
    const { e, f } = group.transform.baseVal.getItem(0).matrix
    return { x: e, y: f }
  })
  const rect = await a.locator('rect').evaluate((element: SVGRectElement) => ({
    width: element.width.baseVal.value, height: element.height.baseVal.value,
  }))
  const x = endpoint.x - position.x
  const y = endpoint.y - position.y
  expect(x).toBeGreaterThanOrEqual(-0.01)
  expect(x).toBeLessThanOrEqual(rect.width + 0.01)
  expect(y).toBeGreaterThanOrEqual(-0.01)
  expect(y).toBeLessThanOrEqual(rect.height + 0.01)
  expect(Math.min(Math.abs(x), Math.abs(y), Math.abs(x - rect.width), Math.abs(y - rect.height))).toBeLessThan(0.01)
  await page.mouse.up()

  const moved = await a.getAttribute('transform')
  await editor.fill(await editor.inputValue() + '  class C\n  class A["이름 변경"]\n')
  await expect(page.locator('[data-class-id="C"]')).toBeVisible()
  await expect(a).toContainText('이름 변경')
  await expect(a).toHaveAttribute('transform', moved!)
})

test('round-trips Order positions, route points and font size through Mermaid source', async ({ page, context }) => {
  await page.goto('/')
  const editor = page.getByRole('textbox', { name: 'Mermaid 코드' })
  const original = 'classDiagram\n  %% Keep this comment\n  %% @font-size Order large\n  Order --> Customer\n  Order : +int count\n'
  await editor.fill(original)
  const order = page.locator('[data-class-id="Order"]')
  const orderTitle = order.locator('.node-label')
  const relationId = '["Order","Customer","none","dependency","solid",0]'
  const edge = page.locator('.relationship').first()
  const handles = page.locator('.bend-handle')
  await expect(order).toBeVisible()
  const originalPath = await edge.getAttribute('d')

  const bounds = (await order.boundingBox())!
  await page.mouse.move(bounds.x + 35, bounds.y + 19)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 58, bounds.y + 132, { steps: 5 })
  await expect(edge).not.toHaveAttribute('d', originalPath!)
  await expect(editor).toHaveValue(original)
  await page.mouse.up()
  await expect(editor).toHaveValue(/%% @layout Order 67 175\n/)
  await expect(order).toHaveAttribute('transform', 'translate(67 175)')

  async function clickLine(fraction: number) {
    const point = await edge.evaluate((path: SVGPathElement, fraction) => {
      const local = path.getPointAtLength(path.getTotalLength() * fraction)
      const { x, y } = new DOMPoint(local.x, local.y).matrixTransform(path.getScreenCTM()!)
      return { x, y }
    }, fraction)
    await page.mouse.dblclick(point.x, point.y)
  }

  await clickLine(0.5)
  await expect(handles).toHaveCount(1)
  await expect(handles.first()).toHaveCSS('opacity', '1')
  const initialHandle = (await handles.first().boundingBox())!
  const beforeBendDrag = await edge.getAttribute('d')
  const beforeBendCode = await editor.inputValue()
  await page.mouse.move(initialHandle.x + 7, initialHandle.y + 7)
  await page.mouse.down()
  await page.mouse.move(initialHandle.x + 17, initialHandle.y + 92, { steps: 5 })
  await expect(edge).not.toHaveAttribute('d', beforeBendDrag!)
  await expect(handles.first()).toHaveCSS('opacity', '1')
  await expect(editor).toHaveValue(beforeBendCode)
  await page.mouse.up()
  await expect(handles.first()).toHaveCSS('opacity', '0')

  await clickLine(0.18)
  await expect(handles).toHaveCount(2)
  const bendCoordinates = await handles.evaluateAll(items => items.map(item => [item.getAttribute('cx'), item.getAttribute('cy')]))
  expect(await editor.inputValue()).toContain('%% @route ' + relationId + ' ' + bendCoordinates.flat().join(' '))

  const movedOrder = (await order.boundingBox())!
  await page.mouse.move(movedOrder.x + 30, movedOrder.y + 18)
  await page.mouse.down()
  await page.mouse.move(movedOrder.x + 42, movedOrder.y + 45, { steps: 4 })
  await page.mouse.up()
  await expect(order).toHaveAttribute('transform', 'translate(79 202)')
  expect(await handles.evaluateAll(items => items.map(item => [item.getAttribute('cx'), item.getAttribute('cy')]))).toEqual(bendCoordinates)

  await orderTitle.click()
  const size = page.getByRole('spinbutton', { name: /글자 크기/ })
  await size.fill('38')
  await size.press('Enter')
  await expect(orderTitle).toHaveCSS('font-size', '38px')
  await expect(order.locator('.member')).toHaveCSS('font-size', '38px')
  expect(await editor.inputValue()).toContain('%% @font-size Order 38\n')

  await editor.fill(await editor.inputValue() + '  Order : +total()\n')
  const method = order.getByText('+total()', { exact: true })
  await expect(method).toHaveCSS('font-size', '38px')
  await expect(order).toHaveAttribute('transform', 'translate(79 202)')
  expect(await handles.evaluateAll(items => items.map(item => [item.getAttribute('cx'), item.getAttribute('cy')]))).toEqual(bendCoordinates)
  expect(await method.evaluate((text: SVGTextElement) => {
    const box = text.getBBox()
    const rect = text.parentElement!.querySelector('rect')!
    return box.x >= 0 && box.y >= 0 && box.x + box.width <= rect.width.baseVal.value &&
      box.y + box.height <= rect.height.baseVal.value
  })).toBe(true)

  const savedCode = await editor.inputValue()
  expect(savedCode.split('\n').filter(line => !/^%% @(layout|route|font-size) /.test(line)).join('\n'))
    .toEqual(original + '  Order : +total()\n')
  const savedPath = await edge.getAttribute('d')
  for (const point of bendCoordinates) expect(savedPath).toContain(' L ' + point.join(' ') + ' L ')
  expect(await edge.evaluate((path: SVGPathElement) => {
    const ends = [
      { id: 'Order', distance: 0 },
      { id: 'Customer', distance: path.getTotalLength() },
    ]
    return ends.every(({ id, distance }) => {
      const rect = document.querySelector<SVGRectElement>('[data-class-id="' + id + '"] rect')!
      const point = path.getPointAtLength(distance)
      const clientPoint = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!)
      return rect.isPointInStroke(clientPoint.matrixTransform(rect.getScreenCTM()!.inverse()))
    })
  })).toBe(true)
  await page.reload()
  await expect(page.locator('[data-class-id="A"]')).toBeVisible()
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate(code => navigator.clipboard.writeText(code), savedCode)
  await editor.focus()
  await editor.press('Control+a')
  await editor.press('Control+v')
  await expect(editor).toHaveValue(savedCode)
  await expect(method).toHaveCSS('font-size', '38px')
  await expect(order).toHaveAttribute('transform', 'translate(79 202)')
  await expect(handles).toHaveCount(2)
  expect(await handles.evaluateAll(items => items.map(item => [item.getAttribute('cx'), item.getAttribute('cy')]))).toEqual(bendCoordinates)
  await expect(edge).toHaveAttribute('d', savedPath!)

  const modified = savedCode
    .replace('%% @layout Order 79 202', '%% @layout Order 30 120')
    .replace('%% @font-size Order 38', '%% @font-size Order 24')
    .replace('%% @route ' + relationId + ' ' + bendCoordinates.flat().join(' '), '%% @route ' + relationId + ' 250 310')
    .replace('  Order --> Customer', '  class Customer\n  Invoice --> Customer\n  Order --> Customer : renamed')
  await editor.fill(modified)
  await expect(order).toHaveAttribute('transform', 'translate(30 120)')
  await expect(method).toHaveCSS('font-size', '24px')
  await expect(page.locator('.relationship')).toHaveCount(2)
  const orderEdge = page.locator('.relationship').nth(1)
  await expect(orderEdge).toHaveAttribute('data-relation-id', relationId)
  await expect(orderEdge).toHaveAttribute('d', /L 250 310 L/)
  await expect(page.locator('.relationship').first()).not.toHaveAttribute('d', /L 250 310 L/)
  await expect(handles).toHaveCount(1)
})

test('zooms around the pointer and pans without changing saved diagram coordinates', async ({ page }) => {
  await page.goto('/')
  const editor = page.getByRole('textbox', { name: 'Mermaid 코드' })
  const relationId = '["Order","Customer","none","dependency","solid",0]'
  const example = [
    'classDiagram',
    'Order --> Customer',
    'Customer --> Address',
    'Order --> Payment',
    'Payment --> Receipt',
    '%% @layout Order 80 110',
    '%% @layout Customer 355 160',
    '%% @layout Address 1300 200',
    '%% @layout Payment 900 520',
    '%% @layout Receipt 1400 740',
    '%% @route ' + relationId + ' 270 230',
    '',
  ].join('\n')
  await editor.fill(example)
  const canvas = page.locator('#canvas')
  const nodes = canvas.locator('.node')
  const order = canvas.locator('[data-class-id="Order"] rect')
  const address = canvas.locator('[data-class-id="Address"] rect')
  const bend = canvas.locator('.bend-handle')
  const edge = canvas.locator('.relationship').first()
  await expect(nodes).toHaveCount(5)
  await page.evaluate(() => {
    document.body.style.paddingBottom = '600px'
    window.scrollTo(0, 20)
  })
  const pageScroll = await page.evaluate(() => window.scrollY)
  const viewport = (await canvas.boundingBox())!
  expect((await address.boundingBox())!.x).toBeGreaterThan(viewport.x + viewport.width)

  await page.mouse.move(viewport.x + 55, viewport.y + 65)
  await page.mouse.wheel(0, 500)
  await expect.poll(() => nodes.evaluateAll(items => {
    const viewport = document.querySelector('#canvas')!.getBoundingClientRect()
    return items.every(item => {
      const box = item.getBoundingClientRect()
      return box.left >= viewport.left && box.right <= viewport.right &&
        box.top >= viewport.top && box.bottom <= viewport.bottom
    })
  })).toBe(true)
  expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll)

  const center = async (element: typeof order) => {
    const box = (await element.boundingBox())!
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  const beforeZoom = await center(order)
  const zoomAnchor = { x: Math.round(beforeZoom.x), y: Math.round(beforeZoom.y) }
  const scaleBeforeZoom = (await order.boundingBox())!.width / 132
  await page.mouse.move(zoomAnchor.x, zoomAnchor.y)
  await page.mouse.wheel(0, -680)
  await expect.poll(async () => (await order.boundingBox())!.width).toBeGreaterThan(132)
  const zoomedOrder = await center(order)
  const scale = await order.evaluate((rect: SVGRectElement) => rect.getScreenCTM()!.a)
  const zoomRatio = scale / scaleBeforeZoom
  expect(zoomedOrder.x).toBeCloseTo(zoomAnchor.x + (beforeZoom.x - zoomAnchor.x) * zoomRatio, 1)
  expect(zoomedOrder.y).toBeCloseTo(zoomAnchor.y + (beforeZoom.y - zoomAnchor.y) * zoomRatio, 1)
  expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll)

  await page.mouse.move(viewport.x + 40, viewport.y + 350)
  await page.mouse.down()
  await page.mouse.move(viewport.x + 140, viewport.y + 430, { steps: 5 })
  await page.mouse.up()
  const pannedOrder = await center(order)
  expect(pannedOrder.x - zoomedOrder.x).toBeCloseTo(100, 0)
  expect(pannedOrder.y - zoomedOrder.y).toBeCloseTo(80, 0)
  await expect(editor).toHaveValue(example)

  const stationaryBend = await center(bend)
  await page.mouse.move(pannedOrder.x, pannedOrder.y)
  await page.mouse.down()
  await page.mouse.move(pannedOrder.x + 62, pannedOrder.y + 56, { steps: 5 })
  const draggingOrder = await center(order)
  expect(draggingOrder.x - pannedOrder.x).toBeCloseTo(62, 0)
  expect(draggingOrder.y - pannedOrder.y).toBeCloseTo(56, 0)
  expect(await center(bend)).toEqual(stationaryBend)
  await page.mouse.up()
  const positionComment = '%% @layout Order ' + Math.round(80 + 62 / scale) + ' ' + Math.round(110 + 56 / scale)
  await expect(editor).toHaveValue(new RegExp(positionComment + '\n'))

  const pannedBend = await center(bend)
  await expect(bend).toHaveCSS('opacity', '0')
  await page.mouse.move(pannedBend.x, pannedBend.y)
  await expect(bend).toHaveCSS('opacity', '1')
  await page.mouse.down()
  await page.mouse.move(pannedBend.x + 45, pannedBend.y + 50, { steps: 5 })
  const draggingBend = await center(bend)
  expect(draggingBend.x - pannedBend.x).toBeCloseTo(45, 0)
  expect(draggingBend.y - pannedBend.y).toBeCloseTo(50, 0)
  await page.mouse.up()
  await expect(bend).toHaveCSS('opacity', '0')

  const bendX = Math.round(270 + 45 / scale)
  const bendY = Math.round(230 + 50 / scale)
  expect(await editor.inputValue()).toBe(example.replace('%% @layout Order 80 110', positionComment)
    .replace('270 230', bendX + ' ' + bendY))
  await expect(edge).toHaveAttribute('d', new RegExp(' L ' + bendX + ' ' + bendY + ' L '))
  expect(await edge.evaluate((path: SVGPathElement) => {
    return ['Order', 'Customer'].every((id, index) => {
      const rect = document.querySelector<SVGRectElement>('[data-class-id="' + id + '"] rect')!
      const endpoint = path.getPointAtLength(index ? path.getTotalLength() : 0)
      const screen = new DOMPoint(endpoint.x, endpoint.y).matrixTransform(path.getScreenCTM()!)
      return rect.isPointInStroke(screen.matrixTransform(rect.getScreenCTM()!.inverse()))
    })
  })).toBe(true)
})

test('prevents diagram text selection while keeping editor fields copyable', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  const editor = page.getByRole('textbox', { name: 'Mermaid 코드' })
  const source = 'classDiagram\nOrder --> Customer : Places an order\nOrder : +int count\nOrder : +total()\n'
  await editor.fill(source)
  const label = page.locator('#canvas .relation-label').filter({ hasText: 'Places an order' })
  await expect(label).toHaveCSS('user-select', 'none')
  const bounds = (await label.boundingBox())!
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width - 2, bounds.y + bounds.height / 2, { steps: 8 })
  expect(await page.evaluate(() => window.getSelection()!.toString())).toBe('')
  await page.mouse.up()
  expect(await page.evaluate(() => window.getSelection()!.toString())).toBe('')
  for (const text of await page.locator('[data-class-id="Order"] text').all()) {
    await expect(text).toHaveCSS('user-select', 'none')
  }

  await editor.press('Control+a')
  await editor.press('Control+c')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(source)

  await page.getByRole('button', { name: 'Order', exact: true }).click()
  const fontSize = page.getByRole('spinbutton', { name: /글자 크기/ })
  await fontSize.press('Control+a')
  await fontSize.press('Control+c')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('15')
})

test('updates the sequence preview in code order and keeps the last valid diagram on errors', async ({ page }) => {
  await page.goto('/')
  const editor = page.getByRole('textbox', { name: 'Mermaid 코드' })
  const code = [
    'sequenceDiagram',
    '    participant U as 사용자',
    '    participant S as 주문 서비스',
    '    U->>S: 주문 요청',
    '    S-->>U: 주문 완료',
    '',
  ].join('\n')
  await editor.fill(code)
  const sequence = page.getByRole('img', { name: '시퀀스 다이어그램' })
  const rows = sequence.locator('.sequence-message')
  const labels = rows.locator('.sequence-message-label')
  await expect(page.locator('#canvas')).toBeHidden()
  await expect(sequence.locator('.sequence-participant-label')).toHaveText(['사용자', '주문 서비스'])
  await expect(sequence.locator('.sequence-lifeline')).toHaveCount(2)
  await expect(labels).toHaveText(['주문 요청', '주문 완료'])
  await expect(rows.nth(0)).toHaveAttribute('data-from', 'U')
  await expect(rows.nth(0)).toHaveAttribute('data-to', 'S')
  await expect(rows.nth(1)).toHaveAttribute('data-from', 'S')
  await expect(rows.nth(1)).toHaveAttribute('data-to', 'U')
  await expect(rows.nth(0).locator('path')).not.toHaveAttribute('stroke-dasharray')
  await expect(rows.nth(1).locator('path')).toHaveAttribute('stroke-dasharray', '6 4')
  expect((await labels.nth(0).boundingBox())!.y).toBeLessThan((await labels.nth(1).boundingBox())!.y)

  const edited = code.replace('주문 요청', '주문 조회').replace('    S-->>U: 주문 완료\n', '')
  await editor.fill(edited)
  await expect(labels).toHaveText(['주문 조회'])
  await editor.fill(edited + '    U->>\n')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(labels).toHaveText(['주문 조회'])

  const reorder = edited.replace('    U->>S: 주문 조회\n', '    S-->>U: 조회 결과\n    U->>S: 주문 조회\n')
  await editor.fill(reorder)
  await expect(page.getByRole('alert')).toBeHidden()
  await expect(labels).toHaveText(['조회 결과', '주문 조회'])
  expect((await labels.nth(0).boundingBox())!.y).toBeLessThan((await labels.nth(1).boundingBox())!.y)

  await editor.fill(basic)
  await expect(sequence).toBeHidden()
  const node = page.locator('[data-class-id="A"]')
  await expect(node).toBeVisible()
  const before = await node.getAttribute('transform')
  const box = (await node.boundingBox())!
  await page.mouse.move(box.x + 30, box.y + 20)
  await page.mouse.down()
  await page.mouse.move(box.x + 80, box.y + 70, { steps: 5 })
  await page.mouse.up()
  await expect(node).not.toHaveAttribute('transform', before!)
  await expect(editor).toHaveValue(/%% @layout A /)
})

for (const name of ['06-seq-basic', '07-seq-blocks']) {
  test('renders the supported sequence rows from ' + name, async ({ page }) => {
    const expected = JSON.parse(readFileSync(new URL('./fixtures/' + name + '.json', import.meta.url), 'utf8')) as {
      participants: { name: string; label: string }[]
      statements: { type: string; lineType?: string; from?: string; to?: string; text?: string }[]
    }
    const messages = expected.statements.filter(row =>
      row.type === 'message' && (row.lineType === 'solid' || row.lineType === 'dotted'))
    await page.goto('/')
    await page.getByRole('textbox', { name: 'Mermaid 코드' }).fill(readFixture(name))
    const sequence = page.getByRole('img', { name: '시퀀스 다이어그램' })
    await expect(sequence.locator('.sequence-participant-label')).toHaveText(expected.participants.map(actor => actor.label))
    await expect(sequence.locator('.sequence-lifeline')).toHaveCount(expected.participants.length)
    await expect(sequence.locator('.sequence-message-label')).toHaveText(messages.map(row => row.text!))
    for (const [index, message] of messages.entries()) {
      const row = sequence.locator('.sequence-message').nth(index)
      await expect(row).toHaveAttribute('data-from', message.from!)
      await expect(row).toHaveAttribute('data-to', message.to!)
      if (message.lineType === 'dotted') await expect(row.locator('path')).toHaveAttribute('stroke-dasharray', '6 4')
      else await expect(row.locator('path')).not.toHaveAttribute('stroke-dasharray')
    }
    await expect(page.getByRole('status')).toContainText('일부 문법은 미리보기에 생략됨')
    if (name === '07-seq-blocks') {
      const loop = sequence.locator('[data-block="loop"]')
      const alt = sequence.locator('[data-block="alt"]')
      await expect(loop.locator('.sequence-frame')).toBeVisible()
      await expect(alt.locator('.sequence-frame')).toBeVisible()
      await expect(alt.locator('.sequence-else')).toHaveCSS('stroke-dasharray', '5px, 4px')
      await expect(loop.locator('.sequence-guard')).toHaveText('매 초')
      await expect(alt.locator('.sequence-guard')).toHaveText(['성공', '실패'])
      await expect(alt.locator('.sequence-branch').nth(1)).toContainText('error')
    }
  })
}

test('nests sequence frames, assigns each else to its alt, and tracks a dragged participant', async ({ page }) => {
  await page.goto('/')
  const editor = page.getByRole('textbox', { name: 'Mermaid 코드' })
  const code = [
    'sequenceDiagram',
    'participant A',
    'participant B',
    'alt 정상',
    '  loop 매 초',
    '    alt 내부 성공',
    '      A->>B: 전송',
    '    else 내부 실패',
    '      B-->>A: 내부 응답',
    '    end',
    '  end',
    'else 재시도',
    '  A->>B: 다시 전송',
    'else 중단',
    '  B-->>A: 중단 응답',
    'end',
    'A->>B: 다음 메시지',
    '',
  ].join('\n')
  await editor.fill(code)
  const canvas = page.locator('#sequence-canvas')
  const outer = canvas.locator('[data-block="alt"]').first()
  const loop = outer.locator('[data-block="loop"]')
  const inner = loop.locator('[data-block="alt"]')
  await expect(outer.locator(':scope > .sequence-guard')).toHaveText(['정상', '재시도', '중단'])
  await expect(outer.locator(':scope > .sequence-else')).toHaveCount(2)
  await expect(inner.locator(':scope > .sequence-guard')).toHaveText(['내부 성공', '내부 실패'])
  await expect(inner.locator(':scope > .sequence-else')).toHaveCount(1)
  await expect(loop.locator(':scope > .sequence-guard')).toHaveText('매 초')
  await expect(canvas.locator('.sequence-message-label')).toHaveText(['전송', '내부 응답', '다시 전송', '중단 응답', '다음 메시지'])
  await expect(page.getByRole('status')).toHaveText('참여자 2명 · 메시지 5개')

  const outerFrame = (await outer.locator(':scope > .sequence-frame').boundingBox())!
  const innerFrame = (await inner.locator(':scope > .sequence-frame').boundingBox())!
  expect(innerFrame.x).toBeGreaterThan(outerFrame.x)
  expect(innerFrame.y).toBeGreaterThan(outerFrame.y)
  expect(innerFrame.y + innerFrame.height).toBeLessThan(outerFrame.y + outerFrame.height)

  const head = canvas.locator('[data-participant-id="A"] rect')
  const box = (await head.boundingBox())!
  const line = canvas.locator('.sequence-lifeline').first()
  const arrow = inner.locator('.sequence-arrow').first()
  const originalX = Number(await line.getAttribute('x1'))
  await page.mouse.move(box.x + 40, box.y + 22)
  await page.mouse.down()
  await page.mouse.move(box.x + 80, box.y + 22, { steps: 4 })
  await expect(line).toHaveAttribute('x1', String(originalX + 40))
  await expect(arrow).toHaveAttribute('d', new RegExp('^M ' + (originalX + 40) + ' '))
  await page.mouse.up()
  await editor.fill((await editor.inputValue()).replace('alt 정상', 'alt 변경된 조건'))
  await expect(outer.locator(':scope > .sequence-guard').first()).toHaveText('변경된 조건')
  await expect(line).toHaveAttribute('x1', String(originalX + 40))
})

test('renders opt, break and nested critical regions with option guards', async ({ page }) => {
  await page.goto('/')
  const editor = page.getByRole('textbox', { name: 'Mermaid 코드' })
  const source = [
    'sequenceDiagram',
    'participant A',
    'participant B',
    'opt 알림 사용',
    '  A->>B: 알림 요청',
    'end',
    'critical 주문 확정',
    '  critical 재고 확인',
    '    A->>B: 재고 조회',
    '  end',
    'option 네트워크 지연',
    '  break 재시도 한도 초과',
    '    B-->>A: 처리 중단',
    '  end',
    'option 권한 거부',
    '  B-->>A: 거부 응답',
    'end',
    'A->>B: 다음 단계',
    '',
  ].join('\n')
  await editor.fill(source)
  const sequence = page.locator('#sequence-canvas')
  const opt = sequence.locator('[data-block="opt"]')
  const outer = sequence.locator('[data-block="critical"]').first()
  const inner = outer.locator('[data-block="critical"]')
  const stop = outer.locator('[data-block="break"]')
  for (const block of [opt, outer, inner, stop]) {
    await expect(block.locator(':scope > .sequence-frame')).toBeVisible()
  }
  await expect(opt.locator(':scope > .sequence-guard')).toHaveText('알림 사용')
  await expect(outer.locator(':scope > .sequence-block-keyword')).toHaveText(['critical', 'option', 'option'])
  await expect(outer.locator(':scope > .sequence-guard')).toHaveText(['주문 확정', '네트워크 지연', '권한 거부'])
  await expect(outer.locator(':scope > .sequence-option')).toHaveCount(2)
  await expect(inner.locator(':scope > .sequence-option')).toHaveCount(0)
  await expect(inner.locator(':scope > .sequence-guard')).toHaveText('재고 확인')
  await expect(stop.locator(':scope > .sequence-guard')).toHaveText('재시도 한도 초과')
  await expect(outer.locator(':scope > .sequence-branch').nth(1).locator('[data-block="break"]')).toHaveCount(1)
  await expect(sequence.locator('.sequence-message-label')).toHaveText(['알림 요청', '재고 조회', '처리 중단', '거부 응답', '다음 단계'])
  await expect(page.getByRole('status')).toHaveText('참여자 2명 · 메시지 5개')
  await editor.fill(source.replace('option 권한 거부', 'option 인증 실패'))
  await expect(outer.locator(':scope > .sequence-guard').last()).toHaveText('인증 실패')
})

test('zooms and pans the sequence viewport and lets a participant follow the pointer', async ({ page }) => {
  await page.goto('/')
  const editor = page.getByRole('textbox', { name: 'Mermaid 코드' })
  const code = 'sequenceDiagram\nparticipant A\nparticipant B\nA->>B: 요청\n'
  await editor.fill(code)
  const canvas = page.locator('#sequence-canvas')
  const head = canvas.locator('[data-participant-id="A"] rect')
  const lifeline = canvas.locator('.sequence-lifeline').first()
  const message = canvas.locator('.sequence-arrow')
  await expect(head).toBeVisible()
  await page.evaluate(() => {
    document.body.style.paddingBottom = '600px'
    window.scrollTo(0, 20)
  })
  const scroll = await page.evaluate(() => window.scrollY)
  const before = (await head.boundingBox())!
  const viewport = (await canvas.boundingBox())!
  const cursor = { x: Math.round(viewport.x + 200), y: Math.round(viewport.y + 115) }
  const worldX = Number(await lifeline.getAttribute('x1'))
  const worldPath = await message.getAttribute('d')

  await page.mouse.move(cursor.x, cursor.y)
  await page.mouse.wheel(0, -175)
  await expect.poll(async () => (await head.boundingBox())!.width).toBeGreaterThan(before.width)
  const zoomed = (await head.boundingBox())!
  const scale = zoomed.width / before.width
  expect(zoomed.x).toBeCloseTo(cursor.x + (before.x - cursor.x) * scale, 1)
  expect(zoomed.y).toBeCloseTo(cursor.y + (before.y - cursor.y) * scale, 1)
  await page.mouse.wheel(0, 175)
  await expect.poll(async () => (await head.boundingBox())!.width).toBeCloseTo(before.width, 1)
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll)
  await page.mouse.wheel(0, -175)
  await expect.poll(async () => (await head.boundingBox())!.width).toBeGreaterThan(before.width)

  await page.mouse.move(viewport.x + 40, viewport.y + 300)
  await page.mouse.down()
  await page.mouse.move(viewport.x + 105, viewport.y + 370, { steps: 4 })
  await page.mouse.up()
  const panned = (await head.boundingBox())!
  expect(panned.x - zoomed.x).toBeCloseTo(65, 1)
  expect(panned.y - zoomed.y).toBeCloseTo(70, 1)
  await expect(lifeline).toHaveAttribute('x1', String(worldX))
  await expect(message).toHaveAttribute('d', worldPath!)

  const grab = { x: Math.round(panned.x + 30), y: Math.round(panned.y + 22) }
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(grab.x + 44, grab.y, { steps: 4 })
  await expect.poll(async () => (await head.boundingBox())!.x - panned.x).toBeCloseTo(44, 1)
  const movedX = Number(await lifeline.getAttribute('x1'))
  expect(movedX - worldX).toBeCloseTo(44 / scale, 1)
  await expect(message).toHaveAttribute('d', new RegExp('^M ' + String(movedX).replace('.', '\\.') + ' '))
  await page.mouse.up()
  const savedX = Number(await head.getAttribute('x'))
  expect(Math.abs(savedX - (32 + 44 / scale))).toBeLessThanOrEqual(0.5)
  await expect(editor).toHaveValue(new RegExp('%% @layout A ' + savedX + ' 32'))
})

test('fits nested sequence frames to their own messages, guards and child frames', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('textbox', { name: 'Mermaid 코드' }).fill([
    'sequenceDiagram',
    'participant U as 사용자',
    'participant A as API',
    'participant P as 결제모듈',
    'loop 주문 처리',
    '  alt 결제 성공',
    '    A->>P: 결제 확인',
    '  else 잔액 부족',
    '    P-->>A: 잔액 부족 오류',
    '    break 결제를 중단해야 하는 경우',
    '      A-->>U: 결제 실패 안내',
    '    end',
    '  end',
    'end',
    'opt 포인트 적립 대상인 경우',
    '  A->>A: 주문 포인트를 적립하고 적립 내역을 기록',
    'end',
    '',
  ].join('\n'))
  const canvas = page.locator('#sequence-canvas')
  const loop = canvas.locator('[data-block="loop"]')
  const alt = loop.locator('[data-block="alt"]')
  const failure = alt.locator(':scope > .sequence-branch').nth(1)
  const stop = failure.locator('[data-block="break"]')
  const opt = canvas.locator('[data-block="opt"]')
  await expect(stop.locator('.sequence-message-label')).toHaveText('결제 실패 안내')
  await expect(opt.locator('.sequence-guard')).toHaveText('포인트 적립 대상인 경우')
  expect(await opt.evaluate(element => element.parentElement!.closest('[data-block]'))).toBeNull()

  const frame = await canvas.evaluate((root: SVGSVGElement) => {
    const bounds = (element: SVGGraphicsElement) => {
      const { x, y, width, height } = element.getBBox()
      return { left: x, top: y, right: x + width, bottom: y + height }
    }
    const block = (kind: string) => root.querySelector<SVGGElement>('[data-block="' + kind + '"]')!
    const outline = (kind: string) => bounds(block(kind).querySelector<SVGRectElement>(':scope > .sequence-frame')!)
    return {
      stop: outline('break'), alt: outline('alt'), loop: outline('loop'), opt: outline('opt'),
      paymentX: Number(root.querySelectorAll('.sequence-lifeline')[2].getAttribute('x1')),
      previous: bounds(block('alt').querySelector<SVGGElement>('.sequence-message[data-from="P"]')!),
      stopMessage: bounds(block('break').querySelector<SVGGElement>('.sequence-message')!),
      optArrow: bounds(block('opt').querySelector<SVGPathElement>('.sequence-arrow')!),
      optText: bounds(block('opt').querySelector<SVGTextElement>('.sequence-message-label')!),
      optGuard: bounds(block('opt').querySelector<SVGTextElement>('.sequence-guard')!),
    }
  })
  expect(frame.stop.top).toBeGreaterThan(frame.previous.bottom)
  expect(frame.stop.right).toBeLessThan(frame.paymentX)
  expect(frame.opt.top).toBeGreaterThan(frame.loop.bottom)
  for (const [outer, inner] of [
    [frame.stop, frame.stopMessage], [frame.alt, frame.stop], [frame.alt, frame.previous],
    [frame.loop, frame.alt], [frame.opt, frame.optArrow], [frame.opt, frame.optText], [frame.opt, frame.optGuard],
  ]) {
    expect(outer.left).toBeLessThan(inner.left)
    expect(outer.right).toBeGreaterThan(inner.right)
    expect(outer.top).toBeLessThan(inner.top)
    expect(outer.bottom).toBeGreaterThan(inner.bottom)
  }
})

for (const kind of ['class', 'sequence'] as const) {
  test('saves, reopens and exports the full ' + kind + ' diagram', async ({ page, context }) => {
    await context.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true, value: undefined,
    }))
    const isClass = kind === 'class'
    const routeId = '["A","B","none","dependency","solid",0]'
    const code = (isClass
      ? ['classDiagram', 'A --> B', 'class Far', '%% @layout A 70 90', '%% @layout B 340 110',
        '%% @layout Far 1450 260', '%% @route ' + routeId + ' 245 210']
      : ['sequenceDiagram', 'participant A as 사용자', 'participant B as API', 'participant Far as 원격 서비스',
        'A->>B: 요청', '%% @layout Far 1450 32']).concat('%% 사용자 주석', '').join('\n')
    await page.goto('/')
    const editor = page.getByRole('textbox', { name: 'Mermaid 코드' })
    await editor.fill(code)
    const idAttr = isClass ? 'data-class-id' : 'data-participant-id'
    const node = (id: string) => page.locator('[' + idAttr + '="' + id + '"] rect')
    await expect(node('A')).toBeVisible()
    const drag = async (target: ReturnType<typeof node>, dx: number, dy: number) => {
      const rect = (await target.boundingBox())!
      const x = Math.round(rect.x + rect.width / 2)
      const y = Math.round(rect.y + rect.height / 2)
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + dx, y + dy, { steps: 4 })
      await page.mouse.up()
    }
    await drag(node('A'), 36, isClass ? 50 : 0)
    await expect(editor).toHaveValue(isClass ? /%% @layout A 106 140/ : /%% @layout A 68 32/)
    if (isClass) {
      await drag(page.locator('.bend-handle'), 10, 28)
      await expect(editor).toHaveValue(/255 238/)
      const font = page.getByRole('spinbutton', { name: /글자 크기/ })
      await font.fill('24')
      await font.press('Enter')
      await expect(editor).toHaveValue(/%% @font-size A 24/)
    }
    await page.getByLabel('색상 모드').selectOption('monochrome')
    const view = page.locator(isClass ? '#class-view' : '#sequence-view')
    await expect(view).toHaveClass(/monochrome/)

    const savedDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: '저장', exact: true }).click()
    const saved = await savedDownload
    expect(saved.suggestedFilename()).toMatch(/\.mmd$/)
    const savedFile = (await saved.path())!
    const savedText = readFileSync(savedFile, 'utf8')
    expect(savedText).toBe(await editor.inputValue())
    expect(savedText).toContain('%% 사용자 주석')

    const reopened = await context.newPage()
    await reopened.goto('/')
    await reopened.locator('#mmd-file').setInputFiles(savedFile)
    const reopenedEditor = reopened.getByRole('textbox', { name: 'Mermaid 코드' })
    await expect(reopenedEditor).toHaveValue(savedText)
    await expect(reopened.getByLabel('색상 모드')).toHaveValue('monochrome')
    if (isClass) {
      await expect(reopened.locator('[data-class-id="A"]')).toHaveAttribute('transform', 'translate(106 140)')
      await expect(reopened.locator('[data-class-id="A"] .node-label')).toHaveCSS('font-size', '24px')
      await expect(reopened.locator('.relationship')).toHaveAttribute('d', /L 255 238 L/)
    } else {
      await expect(reopened.locator('[data-participant-id="A"] rect')).toHaveAttribute('x', '68')
    }
    await reopenedEditor.fill(savedText + (isClass ? 'class Added\n' : 'B-->>A: 응답 추가\n'))
    await expect(isClass ? reopened.locator('[data-class-id="Added"]') : reopened.getByText('응답 추가')).toBeVisible()

    const invalidFile = { name: 'broken.mmd', mimeType: 'text/plain', buffer: Buffer.from('not Mermaid') }
    const current = await reopenedEditor.inputValue()
    await reopened.locator('#mmd-file').setInputFiles(invalidFile)
    await expect(reopened.locator('#file-error')).toContainText('파일 열기 실패')
    await expect(reopenedEditor).toHaveValue(current)
    await expect(isClass ? reopened.locator('[data-class-id="Added"]') : reopened.getByText('응답 추가')).toBeVisible()
    await reopened.locator('#mmd-file').setInputFiles({
      name: 'invalid-utf8.mmd', mimeType: 'text/plain', buffer: Buffer.from([0xff]),
    })
    await expect(reopened.locator('#file-error')).toContainText(/UTF-8/i)
    await expect(reopenedEditor).toHaveValue(current)
    await reopened.locator('#mmd-file').setInputFiles({
      name: 'plain.mmd', mimeType: 'text/plain', buffer: Buffer.from(isClass ? basic : 'sequenceDiagram\nparticipant A\n'),
    })
    await expect(reopened.locator('#file-error')).toBeHidden()
    await expect(reopened.getByLabel('색상 모드')).toHaveValue('color')
    if (isClass) await expect(reopened.locator('[data-class-id="A"]')).toHaveAttribute('transform', 'translate(44 62)')
    else await expect(reopened.locator('[data-participant-id="A"] rect')).toHaveAttribute('x', '32')
    await reopened.close()

    const bounds = (await view.boundingBox())!
    expect((await node('Far').boundingBox())!.x).toBeGreaterThan(bounds.x + bounds.width)
    await page.mouse.move(bounds.x + 100, bounds.y + 300)
    await page.mouse.wheel(0, -140)
    await expect(view.locator('svg > g')).toHaveAttribute('transform', /scale\(1\./)
    const zoomTransform = await view.locator('svg > g').getAttribute('transform')
    await drag(view, -40, 30)
    await expect(view.locator('svg > g')).not.toHaveAttribute('transform', zoomTransform!)

    for (const [format, mime] of [['PNG', 'image/png'], ['JPG', 'image/jpeg']] as const) {
      await page.getByLabel('이미지 형식').selectOption({ label: format })
      const pending = page.waitForEvent('download')
      await page.getByRole('button', { name: '내보내기' }).click()
      const download = await pending
      expect(download.suggestedFilename()).toMatch(new RegExp('\\.' + format.toLowerCase() + '$'))
      const bytes = readFileSync((await download.path())!)
      expect(bytes.subarray(0, format === 'PNG' ? 4 : 2).toString('hex')).toBe(format === 'PNG' ? '89504e47' : 'ffd8')
      const raster = await page.evaluate(async ({ base64, mime }) => {
        const image = new Image()
        image.src = 'data:' + mime + ';base64,' + base64
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0)
        const x = Math.floor(canvas.width * 0.87)
        const pixels = context.getImageData(x, 0, canvas.width - x, canvas.height).data
        let ink = 0
        let chromatic = 0
        for (let index = 0; index < pixels.length; index += 4) {
          const [r, g, b] = pixels.subarray(index, index + 3)
          if (Math.min(r, g, b) < 180) ink++
          if (Math.max(r, g, b) - Math.min(r, g, b) > 8) chromatic++
        }
        return { width: canvas.width, ink, chromatic }
      }, { base64: bytes.toString('base64'), mime })
      expect(raster.width).toBeGreaterThan(bounds.width * 2)
      expect(raster.ink).toBeGreaterThan(100)
      expect(raster.chromatic).toBe(0)
    }
  })
}

test('uses the chosen save destination for MMD, PNG and JPG and respects cancellation', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async (options: { suggestedName: string; types: { accept: Record<string, string[]> }[] }) => {
        const data = document.documentElement.dataset
        data.pickerOptions = JSON.stringify(options)
        data.pickerActivation = String(navigator.userActivation.isActive)
        if (data.cancelPicker === 'yes') throw new DOMException('Cancelled', 'AbortError')
        const root = await navigator.storage.getDirectory()
        const chosen = await root.getDirectoryHandle('chosen-folder', { create: true })
        return chosen.getFileHandle(options.suggestedName, { create: true })
      },
    })
  })
  let downloads = 0
  page.on('download', () => downloads++)
  await page.goto('/')
  await expect(page.locator('[data-class-id="A"]')).toBeVisible()
  const source = await page.getByRole('textbox', { name: 'Mermaid 코드' }).inputValue()
  const readChosen = (name: string) => page.evaluate(async name => {
    const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle('chosen-folder')
    const file = await (await folder.getFileHandle(name)).getFile()
    return { text: name.endsWith('.mmd') ? await file.text() : '', bytes: [...new Uint8Array(await file.slice(0, 4).arrayBuffer())] }
  }, name)

  const mmd = page.getByRole('button', { name: '저장', exact: true })
  const image = page.getByRole('button', { name: '내보내기' })
  for (const [ext, mime, button] of [['mmd', 'text/plain', mmd], ['png', 'image/png', image], ['jpg', 'image/jpeg', image]] as const) {
    if (ext !== 'mmd') await page.getByLabel('이미지 형식').selectOption(ext === 'jpg' ? 'jpeg' : 'png')
    await button.click()
    await expect(button).toBeEnabled()
    const name = 'diagram.' + ext
    const result = await readChosen(name)
    const root = page.locator('html')
    await expect(root).toHaveAttribute('data-picker-activation', 'true')
    const options = JSON.parse((await root.getAttribute('data-picker-options'))!)
    expect(options.suggestedName).toBe(name)
    expect(options.types[0].accept[mime]).toContain('.' + ext)
    if (ext === 'mmd') expect(result.text).toBe(source)
    else if (ext === 'png') expect(result.bytes).toEqual([137, 80, 78, 71])
    else expect(result.bytes.slice(0, 2)).toEqual([255, 216])
  }

  await page.evaluate(() => { document.documentElement.dataset.cancelPicker = 'yes' })
  const saveAs = page.getByRole('button', { name: '다른 이름으로 저장' })
  await saveAs.click()
  await expect(saveAs).toBeEnabled()
  await image.click()
  await expect(image).toBeEnabled()
  await expect(page.locator('#file-error')).toBeHidden()
  expect(downloads).toBe(0)
})

test('hides Mermaid default endpoint labels and keeps explicitly named relationships', async ({ page }) => {
  await page.goto('/')
  const editor = page.getByRole('textbox', { name: 'Mermaid 코드' })
  const labels = page.locator('#canvas .relation-label')
  const displayedLabels = () => labels.evaluateAll(items => items.map(item => item.textContent).filter(Boolean))
  const code = readFixture('02-class-relations')
  await editor.fill(code)
  await expect(page.locator('.relationship')).toHaveCount(6)
  await expect.poll(displayedLabels).toEqual(['소유', '1', '*', '사용'])
  await editor.fill(code + '\n  X "1" --> Y : none\n')
  await expect.poll(displayedLabels).toEqual(['소유', '1', '*', '사용', 'none', '1'])
})

test('renders Mermaid color declarations and preserves their colors in PNG and JPG', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', {
    configurable: true, value: undefined,
  }))
  await page.goto('/')
  const editor = page.getByRole('textbox', { name: 'Mermaid 코드' })
  const expectExportColors = async (colors: number[][]) => {
    for (const [format, mime] of [['png', 'image/png'], ['jpeg', 'image/jpeg']]) {
      await page.getByLabel('이미지 형식').selectOption(format)
      const download = page.waitForEvent('download')
      await page.getByRole('button', { name: '내보내기' }).click()
      const bytes = readFileSync((await (await download).path())!)
      const counts = await page.evaluate(async ({ data, mime, colors }) => {
        const image = new Image()
        image.src = 'data:' + mime + ';base64,' + data
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(image, 0, 0)
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        const counts = colors.map(() => 0)
        for (let i = 0; i < pixels.length; i += 4) {
          for (const [index, [r, g, b]] of colors.entries()) {
            const tolerance = mime === 'image/png' ? (Number.isInteger(r) ? 0 : 2) : 7
            if (Math.abs(r - pixels[i]) <= tolerance && Math.abs(g - pixels[i + 1]) <= tolerance &&
                Math.abs(b - pixels[i + 2]) <= tolerance) counts[index]++
          }
        }
        return counts
      }, { data: bytes.toString('base64'), mime, colors })
      for (const [index, count] of counts.entries()) {
        expect(count, format + ' pixels matching ' + colors[index].join(',')).toBeGreaterThan(100)
      }
    }
  }

  await editor.fill([
    'classDiagram', 'class Customer', 'class Order', 'Customer --> Order : places',
    'class Payment', 'class Delivery',
    'style Customer fill:#DBEAFE,stroke:#2563EB,color:#1e3a8a',
    'style Order fill:#DCFCE7,stroke:#16A34A',
    'style Payment fill:#FB923C,stroke:#9A3412',
    'style Delivery fill:#F472B6,stroke:#9D174D',
  ].join('\n'))
  const classBox = (name: string) => page.locator('[data-class-id="' + name + '"] rect')
  await expect(classBox('Customer')).toHaveCSS('fill', 'rgb(219, 234, 254)')
  await expect(classBox('Customer')).toHaveCSS('stroke', 'rgb(37, 99, 235)')
  await expect(page.locator('[data-class-id="Customer"] .node-label')).toHaveCSS('fill', 'rgb(30, 58, 138)')
  await expect(classBox('Order')).toHaveCSS('fill', 'rgb(220, 252, 231)')
  await expect(classBox('Payment')).toHaveCSS('fill', 'rgb(251, 146, 60)')
  await expect(classBox('Delivery')).toHaveCSS('fill', 'rgb(244, 114, 182)')
  await expectExportColors([[219, 234, 254], [220, 252, 231], [251, 146, 60], [244, 114, 182]])

  await editor.fill([
    'sequenceDiagram', 'box rgb(160,210,255) Frontend', 'participant A', 'end', 'participant B',
    'rect rgb(250,185,105)', 'A->>B: Request', 'end', 'rect rgba(100,40,160,0.5)', 'B->>B: Work', 'end',
  ].join('\n'))
  const background = page.locator('.sequence-highlight')
  await expect(page.locator('.sequence-group rect')).toHaveCSS('fill', 'rgb(160, 210, 255)')
  await expect(page.locator('.sequence-group-label')).toHaveText('Frontend')
  await expect(background.nth(0)).toHaveCSS('fill', 'rgb(250, 185, 105)')
  await expect(background.nth(1)).toHaveCSS('fill', 'rgba(100, 40, 160, 0.5)')
  await expectExportColors([[160, 210, 255], [250, 185, 105], [177.5, 147.5, 207.5]])
})

test('resaves the active Mermaid file and switches the target only after opening or saving a copy', async ({ page }) => {
  await page.addInitScript(() => {
    const root = () => navigator.storage.getDirectory()
    Object.defineProperties(window, {
      showSaveFilePicker: {
        configurable: true,
        value: async ({ suggestedName }: { suggestedName: string }) => {
          const data = document.documentElement.dataset
          data.savePicks = String(Number(data.savePicks ?? 0) + 1)
          if (data.pickName === 'cancel') throw new DOMException('취소', 'AbortError')
          return (await root()).getFileHandle(data.pickName ?? suggestedName, { create: true })
        },
      },
      showOpenFilePicker: {
        configurable: true,
        value: async () => {
          const handle = await (await root()).getFileHandle('opened.mmd', { create: true })
          const stream = await handle.createWritable()
          await stream.write('classDiagram\nclass Opened\n')
          await stream.close()
          return [handle]
        },
      },
    })
  })
  await page.goto('/')
  const editor = page.getByRole('textbox', { name: 'Mermaid 코드' })
  const save = page.getByRole('button', { name: '저장', exact: true })
  const saveAs = page.getByRole('button', { name: '다른 이름으로 저장' })
  const root = page.locator('html')
  const read = (name: string) => page.evaluate(async name => {
    const folder = await navigator.storage.getDirectory()
    return (await (await folder.getFileHandle(name)).getFile()).text()
  }, name)
  const pick = (name: string) => page.evaluate(name => { document.documentElement.dataset.pickName = name }, name)
  const edit = (name: string) => editor.fill('classDiagram\nclass ' + name + '\n')

  await edit('First')
  await pick('original.mmd')
  await save.click()
  await expect(save).toBeEnabled()
  expect(await read('original.mmd')).toContain('class First')
  await edit('Updated')
  await save.click()
  await expect(save).toBeEnabled()
  expect(await read('original.mmd')).toContain('class Updated')
  await expect(root).toHaveAttribute('data-save-picks', '1')

  await pick('cancel')
  await saveAs.click()
  await expect(saveAs).toBeEnabled()
  await edit('AfterCancel')
  await save.click()
  await expect(save).toBeEnabled()
  expect(await read('original.mmd')).toContain('class AfterCancel')
  await expect(root).toHaveAttribute('data-save-picks', '2')

  await pick('copy.mmd')
  await saveAs.click()
  await expect(saveAs).toBeEnabled()
  await edit('CopyOnly')
  await save.click()
  await expect(save).toBeEnabled()
  expect(await read('copy.mmd')).toContain('class CopyOnly')
  expect(await read('original.mmd')).toContain('class AfterCancel')
  await expect(root).toHaveAttribute('data-save-picks', '3')

  await page.getByRole('button', { name: '열기', exact: true }).click()
  await expect(editor).toHaveValue('classDiagram\nclass Opened\n')
  await edit('OpenedUpdated')
  await save.click()
  await expect(save).toBeEnabled()
  expect(await read('opened.mmd')).toContain('class OpenedUpdated')
  expect(await read('copy.mmd')).toContain('class CopyOnly')
  await expect(root).toHaveAttribute('data-save-picks', '3')
})
