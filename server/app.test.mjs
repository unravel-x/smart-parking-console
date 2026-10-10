import { describe, expect, it, vi } from 'vitest'
import { createApp } from './app.mjs'
import { createFtpResultStore } from './ftp-results.mjs'

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3])

async function withServer(recognize, run) {
  const app = createApp({ recognize })
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })
  try { await run(`http://127.0.0.1:${server.address().port}`) }
  finally { await new Promise(resolve => server.close(resolve)) }
}

function imageBody(bytes = png, type = 'image/png') {
  const body = new FormData()
  body.append('image', new Blob([bytes], { type }), 'capture.png')
  return body
}

describe('OCR 代理上传接口', () => {
  it('上传图片并返回可供前端选择的候选车牌', async () => {
    await withServer(async image => {
      expect(image.subarray(0, 8)).toEqual(png.subarray(0, 8))
      return { Number: '京A12345', Confidence: 98, Color: '蓝', RequestId: 'id-1', LicensePlateInfos: [{ Number: '京A12345', Confidence: 98, Color: '蓝' }] }
    }, async base => {
      const response = await fetch(`${base}/api/recognitions`, { method: 'POST', body: imageBody(), headers: { Origin: 'http://127.0.0.1:5173' } })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ plateNo: '京A12345', confidence: 0.98, requestId: 'id-1' })
      expect(response.headers.get('cache-control')).toBe('no-store')
    })
  })

  it('允许端口漂移期间从 5174 上传图片', async () => {
    await withServer(async () => ({ Number: '京Q01US9', Confidence: 99, RequestId: 'id-5174' }), async base => {
      const response = await fetch(`${base}/api/recognitions`, { method: 'POST', body: imageBody(), headers: { Origin: 'http://127.0.0.1:5174' } })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ plateNo: '京Q01US9', requestId: 'id-5174' })
    })
  })

  it('拒绝缺失图片、伪造图片和非本地页面来源', async () => {
    await withServer(async () => { throw new Error('不应调用腾讯云') }, async base => {
      const missing = await fetch(`${base}/api/recognitions`, { method: 'POST', body: new FormData() })
      expect(missing.status).toBe(400)
      const forged = await fetch(`${base}/api/recognitions`, { method: 'POST', body: imageBody(Buffer.from('not a png')) })
      expect(forged.status).toBe(415)
      const forbidden = await fetch(`${base}/api/recognitions`, { method: 'POST', body: imageBody(), headers: { Origin: 'https://other.example' } })
      expect(forbidden.status).toBe(403)
    })
  })

  it('缺少密钥时返回可操作的提示', async () => {
    const error = Object.assign(new Error('请先在项目根目录的 .env 中填写 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY'), { code: 'OCR_NOT_CONFIGURED' })
    await withServer(async () => { throw error }, async base => {
      const response = await fetch(`${base}/api/recognitions`, { method: 'POST', body: imageBody() })
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ code: 'OCR_NOT_CONFIGURED' })
    })
  })
})

describe('FTP 轮询接口', () => {
  it('未配置轮询器时返回未配置状态', async () => {
    const app = createApp({ recognize: async () => { throw new Error('不应调用腾讯云') }, ftpPoller: null })
    const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)) })
    try {
      const base = `http://127.0.0.1:${server.address().port}`
      const response = await fetch(`${base}/api/ftp-results`)
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.json()).toEqual({ configured: false, latestId: null, results: [] })
      const image = await fetch(`${base}/api/ftp-images/1`)
      expect(image.status).toBe(404)
      expect(await image.json()).toMatchObject({ code: 'FTP_IMAGE_NOT_FOUND' })
    } finally { await new Promise(resolve => server.close(resolve)) }
  })

  it('拒绝非本地页面来源读取 FTP 结果', async () => {
    const app = createApp({ recognize: async () => { throw new Error('不应调用腾讯云') }, ftpPoller: null })
    const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)) })
    try {
      const base = `http://127.0.0.1:${server.address().port}`
      const response = await fetch(`${base}/api/ftp-results`, { headers: { Origin: 'https://other.example' } })
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: 'ORIGIN_FORBIDDEN' })
    } finally { await new Promise(resolve => server.close(resolve)) }
  })

  it('返回结果缓冲中的条目及其图片字节', async () => {
    const ftpResults = createFtpResultStore()
    ftpResults.setConfigured(true)
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3])
    const entry = ftpResults.push({ fileName: 'a.png', imageBuffer: bytes, imageType: 'image/png', plateNo: '京A12345', confidence: 0.98, color: '蓝', candidates: [], requestId: 'r1', status: 'ok', errorCode: null, errorMessage: null })
    const app = createApp({ recognize: async () => { throw new Error('不应调用腾讯云') }, ftpPoller: { start: () => {} }, ftpResults })
    const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)) })
    try {
      const base = `http://127.0.0.1:${server.address().port}`
      const response = await fetch(`${base}/api/ftp-results?since=0`)
      const body = await response.json()
      expect(body.configured).toBe(true)
      expect(body.results).toHaveLength(1)
      expect(body.results[0]).toMatchObject({ id: entry.id, plateNo: '京A12345' })
      const image = await fetch(`${base}/api/ftp-images/${entry.id}`)
      expect(image.status).toBe(200)
      expect(image.headers.get('content-type')).toBe('image/png')
      expect(Buffer.from(await image.arrayBuffer())).toEqual(bytes)
    } finally { await new Promise(resolve => server.close(resolve)) }
  })

  it('startFtpPoller 委托给注入的轮询器', () => {
    const start = vi.fn()
    const app = createApp({ ftpPoller: { start } })
    app.startFtpPoller()
    expect(start).toHaveBeenCalledTimes(1)
  })
})
