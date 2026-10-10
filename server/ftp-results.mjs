export function createFtpResultStore({ maxResults = 20 } = {}) {
  let entries = []
  let nextId = 1
  let configured = false

  function setConfigured(value) {
    configured = Boolean(value)
  }

  function push(item) {
    const receivedAtMs = Date.now()
    const entry = { id: nextId++, receivedAt: new Date(receivedAtMs).toISOString(), receivedAtMs, ...item }
    entries = [entry, ...entries].slice(0, maxResults)
    return entry
  }

  function toDto(entry) {
    const { imageBuffer, imageType, receivedAtMs, ...rest } = entry
    return { ...rest, imageUrl: `/api/ftp-images/${entry.id}?v=${entry.receivedAtMs}` }
  }

  function list(sinceId) {
    const results = sinceId === null ? [...entries] : entries.filter(entry => entry.id > sinceId)
    const latestId = entries.length ? entries[0].id : null
    return { configured, latestId, results: results.map(toDto) }
  }

  function getImage(id) {
    if (!Number.isInteger(id)) return null
    const entry = entries.find(item => item.id === id)
    if (!entry || !entry.imageBuffer || !entry.imageType) return null
    return { buffer: entry.imageBuffer, imageType: entry.imageType }
  }

  return { setConfigured, push, list, getImage }
}
