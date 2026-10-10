import { describe, expect, it } from 'vitest'
import { createFtpResultStore } from './ftp-results.mjs'

function sampleItem(plateNo = '京A12345') {
  return {
    fileName: 'a.jpg',
    imageBuffer: Buffer.from([1, 2, 3]),
    imageType: 'image/jpeg',
    plateNo,
    confidence: 0.98,
    color: '蓝',
    candidates: [],
    requestId: 'r1',
    status: 'ok',
    errorCode: null,
    errorMessage: null,
  }
}

describe('FTP 结果缓冲', () => {
  it('只保留最近 20 条并淘汰最旧的图片', () => {
    const store = createFtpResultStore()
    for (let i = 0; i < 25; i++) store.push(sampleItem(`京A${i}`))
    const { results, latestId } = store.list(null)
    expect(results).toHaveLength(20)
    expect(latestId).toBe(25)
    expect(results[0].id).toBe(25)
    expect(results[19].id).toBe(6)
    expect(store.getImage(5)).toBeNull()
  })

  it('list(since) 只返回更新的结果', () => {
    const store = createFtpResultStore()
    store.push(sampleItem())
    store.push(sampleItem('京B12345'))
    const { results, latestId } = store.list(1)
    expect(latestId).toBe(2)
    expect(results).toHaveLength(1)
    expect(results[0].plateNo).toBe('京B12345')
    expect(store.list(99).results).toHaveLength(0)
  })

  it('since 落后于保留窗口时返回全部', () => {
    const store = createFtpResultStore()
    for (let i = 0; i < 25; i++) store.push(sampleItem())
    expect(store.list(1).results).toHaveLength(20)
  })

  it('DTO 不含 buffer 且带缓存失效参数', () => {
    const store = createFtpResultStore()
    store.push(sampleItem())
    const [dto] = store.list(null).results
    expect(dto).not.toHaveProperty('imageBuffer')
    expect(dto).not.toHaveProperty('imageType')
    expect(dto.imageUrl).toMatch(/^\/api\/ftp-images\/1\?v=\d+$/)
  })

  it('getImage 返回原始字节与类型,配置标志可设置', () => {
    const store = createFtpResultStore()
    store.setConfigured(true)
    const entry = store.push(sampleItem())
    expect(store.list(null).configured).toBe(true)
    const image = store.getImage(entry.id)
    expect(image.imageType).toBe('image/jpeg')
    expect(image.buffer).toEqual(Buffer.from([1, 2, 3]))
    expect(store.getImage(999)).toBeNull()
    expect(store.getImage('x')).toBeNull()
  })
})
