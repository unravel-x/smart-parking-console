import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchFtpResults } from './ftpResults'

afterEach(() => vi.unstubAllGlobals())

describe('fetchFtpResults', () => {
  it('携带 since 参数并解析响应', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(input).toBe('/api/ftp-results?since=2')
      return new Response(JSON.stringify({
        configured: true,
        latestId: 3,
        results: [{ id: 3, fileName: 'a.jpg', receivedAt: '2026-10-10T00:00:00.000Z', plateNo: '京A12345', confidence: 0.98, color: '蓝', candidates: [], requestId: 'r1', status: 'ok', errorCode: null, errorMessage: null, imageUrl: '/api/ftp-images/3?v=1' }],
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const data = await fetchFtpResults(2)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(data.configured).toBe(true)
    expect(data.latestId).toBe(3)
    expect(data.results).toHaveLength(1)
    expect(data.results[0].plateNo).toBe('京A12345')
  })

  it('since 为 null 时不带查询参数', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(input).toBe('/api/ftp-results')
      return new Response(JSON.stringify({ configured: false, latestId: null, results: [] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    await fetchFtpResults(null)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('非 OK 时抛出后端 message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'X', message: '后端错误提示' }), { status: 503 })))
    await expect(fetchFtpResults(null)).rejects.toThrow('后端错误提示')
  })

  it('连接失败时给出本地服务提示', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(fetchFtpResults(null)).rejects.toThrow('无法连接本地 OCR 服务')
  })

  it('非 JSON 响应给出代理异常提示', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 502 })))
    await expect(fetchFtpResults(null)).rejects.toThrow('本地 OCR 代理返回异常')
  })

  it('过滤掉形状不合法的结果条目', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ configured: true, latestId: 2, results: [{ id: 1, fileName: 'a.jpg' }, null, { id: 'bad' }, { id: 2, fileName: 'b.png' }] }), { status: 200 })))
    const data = await fetchFtpResults(null)
    expect(data.results.map(item => item.id)).toEqual([1, 2])
  })
})
