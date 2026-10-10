import { Writable } from 'node:stream'
import { Client, FileType } from 'basic-ftp'
import { MAX_IMAGE_BYTES, detectImageType } from './image-utils.mjs'

const HANDLED_TTL_MS = 5 * 60 * 1000

export function createFtpClient() {
  return new Client()
}

export function ftpConfigFromEnv(env = process.env) {
  const host = env.FTP_HOST?.trim()
  const user = env.FTP_USER?.trim()
  const password = env.FTP_PASSWORD ?? ''
  const inboxDir = env.FTP_INBOX_DIR?.trim()
  if (!host || !user || !password.trim() || !inboxDir) return null
  const parsed = Number(env.FTP_PORT ?? '21')
  const port = Number.isInteger(parsed) && parsed > 0 ? parsed : 21
  return { host, port, user, password, inboxDir }
}

function createMemorySink(maxBytes) {
  const chunks = []
  let size = 0
  let overflow = false
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      size += chunk.length
      if (!overflow) {
        if (size > maxBytes) { overflow = true; chunks.length = 0 }
        else chunks.push(Buffer.from(chunk))
      }
      callback()
    },
  })
  return {
    writable,
    get buffer() { return overflow ? null : Buffer.concat(chunks) },
    get overflow() { return overflow },
  }
}

export function createFtpPoller({
  client,
  recognize,
  ftpConfig,
  inboxDir,
  pollIntervalMs = 3000,
  minAgeMs = 2000,
  onResult = () => {},
  onError = () => {},
} = {}) {
  let timer = null
  let busy = false
  const pending = new Map()
  const handled = new Map()
  const remotePath = (...parts) => parts.join('/').replace(/\/{2,}/g, '/')
  const processedDir = remotePath(inboxDir, 'processed')
  const failedDir = remotePath(inboxDir, 'failed')

  function stamp() {
    const d = new Date()
    const pad = (n, len = 2) => String(n).padStart(len, '0')
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`
  }

  async function ensureConnected() {
    if (client.closed) {
      await client.access(ftpConfig)
      await client.ensureDir(processedDir)
      await client.ensureDir(failedDir)
    }
  }

  async function moveTo(dir, name) {
    const source = remotePath(inboxDir, name)
    const target = remotePath(dir, `${stamp()}_${name}`)
    try {
      await client.rename(source, target)
    } catch (error) {
      await client.ensureDir(dir)
      await client.rename(source, target)
    }
  }

  function isStable(info) {
    if (info.modifiedAt instanceof Date && !Number.isNaN(info.modifiedAt.getTime())) {
      if (Date.now() - info.modifiedAt.getTime() >= minAgeMs) return true
    }
    const seen = pending.get(info.name)
    return Boolean(seen && seen.size === info.size && Date.now() - seen.firstSeenAt >= minAgeMs)
  }

  function baseItem(info, overrides) {
    return {
      fileName: info.name,
      imageBuffer: null,
      imageType: null,
      plateNo: null,
      confidence: null,
      color: null,
      candidates: [],
      requestId: null,
      status: 'failed',
      errorCode: null,
      errorMessage: null,
      ...overrides,
    }
  }

  async function pollOnce() {
    if (busy) return
    busy = true
    try {
      await ensureConnected()
      const files = await client.list(inboxDir)
      const names = new Set()
      for (const info of files) {
        if (info.type !== FileType.File) continue
        names.add(info.name)
        const handledAt = handled.get(info.name)
        if (handledAt && Date.now() - handledAt < HANDLED_TTL_MS) continue
        if (!isStable(info)) {
          const seen = pending.get(info.name)
          if (!seen || seen.size !== info.size) pending.set(info.name, { size: info.size, firstSeenAt: Date.now() })
          continue
        }
        pending.delete(info.name)

        if (info.size > MAX_IMAGE_BYTES) {
          await moveTo(failedDir, info.name).catch(error => onError(error, `move ${info.name}`))
          onResult(baseItem(info, { status: 'failed', errorCode: 'IMAGE_TOO_LARGE', errorMessage: '图片不能超过 4 MB' }))
          continue
        }
        const sink = createMemorySink(MAX_IMAGE_BYTES)
        try {
          await client.downloadTo(sink.writable, remotePath(inboxDir, info.name))
        } catch (error) {
          onError(error, `download ${info.name}`)
          continue
        }
        if (sink.overflow) {
          await moveTo(failedDir, info.name).catch(error => onError(error, `move ${info.name}`))
          onResult(baseItem(info, { status: 'failed', errorCode: 'IMAGE_TOO_LARGE', errorMessage: '图片不能超过 4 MB' }))
          continue
        }
        const imageType = detectImageType(sink.buffer)
        if (!imageType) {
          await moveTo(failedDir, info.name).catch(error => onError(error, `move ${info.name}`))
          onResult(baseItem(info, { status: 'failed', errorCode: 'UNSUPPORTED_IMAGE', errorMessage: '只支持真实的 JPG 或 PNG 图片' }))
          continue
        }
        try {
          const data = await recognize(sink.buffer)
          handled.set(info.name, Date.now())
          await moveTo(processedDir, info.name).catch(error => onError(error, `move ${info.name}`))
          onResult(baseItem(info, {
            imageBuffer: sink.buffer,
            imageType,
            plateNo: data.plateNo,
            confidence: data.confidence ?? null,
            color: data.candidates?.[0]?.color ?? null,
            candidates: data.candidates ?? [],
            requestId: data.requestId ?? null,
            status: 'ok',
          }))
        } catch (error) {
          const code = typeof error?.code === 'string' ? error.code : 'OCR_UPSTREAM_ERROR'
          if (code === 'OCR_NOT_CONFIGURED') { onError(error, `recognize ${info.name}`); break }
          await moveTo(failedDir, info.name).catch(moveError => onError(moveError, `move ${info.name}`))
          onResult(baseItem(info, {
            imageBuffer: sink.buffer,
            imageType,
            status: code === 'OCR_NO_PLATE' ? 'no_plate' : 'failed',
            errorCode: code,
            errorMessage: error?.message ?? '识别服务暂时不可用，请稍后重试',
          }))
        }
      }
      for (const name of pending.keys()) if (!names.has(name)) pending.delete(name)
      for (const [name, at] of handled) if (Date.now() - at >= HANDLED_TTL_MS) handled.delete(name)
    } catch (error) {
      onError(error, 'poll')
      try { client.close() } catch { /* 忽略关闭异常 */ }
    } finally {
      busy = false
    }
  }

  function start() {
    if (timer) return
    void pollOnce()
    timer = setInterval(() => void pollOnce(), pollIntervalMs)
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null }
    try { client.close() } catch { /* 忽略关闭异常 */ }
  }

  return { start, stop, pollOnce }
}
