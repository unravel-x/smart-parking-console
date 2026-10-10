import { describe, expect, it, vi } from 'vitest'
import { FileType } from 'basic-ftp'
import { createFtpPoller } from './ftp-poller.mjs'

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3])
const config = { host: 'ftp.test', port: 21, user: 'u', password: 'p' }

function fakeClient(files = []) {
  const client = {
    closed: true,
    calls: [],
    files,
    downloadBytes: png,
    async access() { this.calls.push('access'); this.closed = false },
    async list() { this.calls.push('list'); return this.files },
    async downloadTo(sink, remote) {
      this.calls.push(`downloadTo ${remote}`)
      const done = new Promise(resolve => sink.once('finish', resolve))
      sink.end(this.downloadBytes)
      await done
    },
    async rename(from, to) { this.calls.push(`rename ${from} -> ${to}`) },
    async ensureDir(dir) { this.calls.push(`ensureDir ${dir}`) },
    close() { this.calls.push('close'); this.closed = true },
  }
  return client
}

function fileInfo(name, { size = png.length, modifiedAt, type = FileType.File } = {}) {
  return { name, type, size, modifiedAt }
}

const okResult = { plateNo: '京A12345', confidence: 0.98, candidates: [{ plateNo: '京A12345', confidence: 0.98, color: '蓝', rect: null }], requestId: 'req-1' }

describe('FTP 轮询器', () => {
  it('跳过最近修改的文件,稳定后识别并移入 processed', async () => {
    const client = fakeClient()
    const info = fileInfo('plate.png', { modifiedAt: new Date() })
    client.files = [info]
    const recognize = vi.fn(async () => okResult)
    const onResult = vi.fn()
    const poller = createFtpPoller({ client, recognize, ftpConfig: config, inboxDir: '/inbox', onResult })
    await poller.pollOnce()
    expect(recognize).not.toHaveBeenCalled()
    info.modifiedAt = new Date(Date.now() - 5000)
    await poller.pollOnce()
    expect(recognize).toHaveBeenCalledTimes(1)
    const result = onResult.mock.calls[0][0]
    expect(result.status).toBe('ok')
    expect(result.plateNo).toBe('京A12345')
    expect(result.color).toBe('蓝')
    expect(result.imageType).toBe('image/png')
    const rename = client.calls.find(call => call.startsWith('rename'))
    expect(rename).toMatch(/^rename \/inbox\/plate\.png -> \/inbox\/processed\/\d{8}-\d{6}-\d{3}_plate\.png$/)
  })

  it('服务器不提供修改时间时,连续两轮大小一致才处理', async () => {
    const client = fakeClient([fileInfo('plate.png')])
    const recognize = vi.fn(async () => okResult)
    const poller = createFtpPoller({ client, recognize, ftpConfig: config, inboxDir: '/inbox', minAgeMs: 0 })
    await poller.pollOnce()
    expect(recognize).not.toHaveBeenCalled()
    await poller.pollOnce()
    expect(recognize).toHaveBeenCalledTimes(1)
  })

  it('大小变化的文件重新计时', async () => {
    const client = fakeClient()
    const info = fileInfo('plate.png', { size: 100 })
    client.files = [info]
    const recognize = vi.fn(async () => okResult)
    const poller = createFtpPoller({ client, recognize, ftpConfig: config, inboxDir: '/inbox', minAgeMs: 0 })
    await poller.pollOnce()
    info.size = 200
    await poller.pollOnce()
    expect(recognize).not.toHaveBeenCalled()
    await poller.pollOnce()
    expect(recognize).toHaveBeenCalledTimes(1)
  })

  it('未识别到车牌的文件移入 failed 并记录 no_plate', async () => {
    const client = fakeClient([fileInfo('nope.png', { modifiedAt: new Date(Date.now() - 5000) })])
    const error = Object.assign(new Error('图片中未识别到车牌'), { code: 'OCR_NO_PLATE' })
    const recognize = vi.fn(async () => { throw error })
    const onResult = vi.fn()
    const poller = createFtpPoller({ client, recognize, ftpConfig: config, inboxDir: '/inbox', onResult })
    await poller.pollOnce()
    const result = onResult.mock.calls[0][0]
    expect(result.status).toBe('no_plate')
    expect(result.errorCode).toBe('OCR_NO_PLATE')
    expect(client.calls.some(call => call.startsWith('rename') && call.includes('/failed/'))).toBe(true)
  })

  it('密钥未配置时文件留在原地并中止本轮', async () => {
    const client = fakeClient([
      fileInfo('a.png', { modifiedAt: new Date(Date.now() - 5000) }),
      fileInfo('b.png', { modifiedAt: new Date(Date.now() - 5000) }),
    ])
    const error = Object.assign(new Error('请先在 .env 填写密钥'), { code: 'OCR_NOT_CONFIGURED' })
    const recognize = vi.fn(async () => { throw error })
    const onResult = vi.fn()
    const onError = vi.fn()
    const poller = createFtpPoller({ client, recognize, ftpConfig: config, inboxDir: '/inbox', onResult, onError })
    await poller.pollOnce()
    expect(recognize).toHaveBeenCalledTimes(1)
    expect(onResult).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(client.calls.filter(call => call.startsWith('rename'))).toHaveLength(0)
  })

  it('超过 4 MB 的文件不下载直接移入 failed', async () => {
    const client = fakeClient([fileInfo('big.png', { size: 5 * 1024 * 1024, modifiedAt: new Date(Date.now() - 5000) })])
    const recognize = vi.fn()
    const onResult = vi.fn()
    const poller = createFtpPoller({ client, recognize, ftpConfig: config, inboxDir: '/inbox', onResult })
    await poller.pollOnce()
    expect(recognize).not.toHaveBeenCalled()
    expect(client.calls.some(call => call.startsWith('downloadTo'))).toBe(false)
    expect(onResult.mock.calls[0][0].errorCode).toBe('IMAGE_TOO_LARGE')
  })

  it('魔数不是图片的文件移入 failed 且不识别', async () => {
    const client = fakeClient([fileInfo('fake.jpg', { modifiedAt: new Date(Date.now() - 5000) })])
    client.downloadBytes = Buffer.from('not an image at all')
    const recognize = vi.fn()
    const onResult = vi.fn()
    const poller = createFtpPoller({ client, recognize, ftpConfig: config, inboxDir: '/inbox', onResult })
    await poller.pollOnce()
    expect(recognize).not.toHaveBeenCalled()
    expect(onResult.mock.calls[0][0].errorCode).toBe('UNSUPPORTED_IMAGE')
  })

  it('连接失败时上报错误并关闭连接,恢复后可继续', async () => {
    const client = fakeClient()
    client.list = async () => { throw new Error('ECONNREFUSED') }
    const onError = vi.fn()
    const poller = createFtpPoller({ client, recognize: vi.fn(), ftpConfig: config, inboxDir: '/inbox', onError })
    await poller.pollOnce()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(client.closed).toBe(true)
    client.list = async () => []
    await poller.pollOnce()
    expect(client.calls.filter(call => call === 'access')).toHaveLength(2)
  })

  it('start 立即轮询并按间隔重复,stop 停止,重复 start 不叠加', async () => {
    vi.useFakeTimers()
    try {
      const client = fakeClient()
      const poller = createFtpPoller({ client, recognize: vi.fn(async () => okResult), ftpConfig: config, inboxDir: '/inbox' })
      poller.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(client.calls.filter(call => call === 'list')).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(3000)
      await vi.advanceTimersByTimeAsync(3000)
      expect(client.calls.filter(call => call === 'list')).toHaveLength(3)
      poller.start()
      await vi.advanceTimersByTimeAsync(3000)
      expect(client.calls.filter(call => call === 'list')).toHaveLength(4)
      poller.stop()
      await vi.advanceTimersByTimeAsync(9000)
      expect(client.calls.filter(call => call === 'list')).toHaveLength(4)
      expect(client.closed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('跳过目录条目', async () => {
    const client = fakeClient([
      { name: 'processed', type: FileType.Directory },
      fileInfo('plate.png', { modifiedAt: new Date(Date.now() - 5000) }),
    ])
    const recognize = vi.fn(async () => okResult)
    const onResult = vi.fn()
    const poller = createFtpPoller({ client, recognize, ftpConfig: config, inboxDir: '/inbox', onResult })
    await poller.pollOnce()
    expect(recognize).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(client.calls.some(call => call.startsWith('downloadTo') && call.includes('processed'))).toBe(false)
  })
})
