import type { PlateCandidate } from './recognition'

export type FtpResultStatus = 'ok' | 'no_plate' | 'failed'

export interface FtpResult {
  id: number
  fileName: string
  receivedAt: string
  plateNo: string | null
  confidence: number | null
  color: string | null
  candidates: PlateCandidate[]
  requestId: string | null
  status: FtpResultStatus
  errorCode: string | null
  errorMessage: string | null
  imageUrl: string | null
}

export interface FtpResultsResponse {
  configured: boolean
  latestId: number | null
  results: FtpResult[]
}

export async function fetchFtpResults(since: number | null): Promise<FtpResultsResponse> {
  const url = `/api/ftp-results${since === null ? '' : `?since=${since}`}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch(url, { signal: controller.signal })
    const responseText = await response.text()
    let data: unknown
    try { data = JSON.parse(responseText) }
    catch { throw new Error(`本地 OCR 代理返回异常（HTTP ${response.status}）。请确认只运行一套 npm run dev，并使用 http://127.0.0.1:5173`) }
    if (!response.ok) {
      const message = data && typeof data === 'object' && 'message' in data && typeof data.message === 'string' ? data.message : `识别服务返回 ${response.status}`
      throw new Error(message)
    }
    const object = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
    const rawResults = Array.isArray(object.results) ? object.results : []
    const results = rawResults.filter((item): item is FtpResult =>
      Boolean(item) && typeof item === 'object' && typeof (item as FtpResult).id === 'number' && typeof (item as FtpResult).fileName === 'string')
    return {
      configured: typeof object.configured === 'boolean' ? object.configured : false,
      latestId: typeof object.latestId === 'number' ? object.latestId : null,
      results,
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('获取 FTP 识别结果超时')
    if (error instanceof TypeError) throw new Error('无法连接本地 OCR 服务。请确认只运行一套 npm run dev，并使用 http://127.0.0.1:5173')
    throw error
  } finally { clearTimeout(timeout) }
}
