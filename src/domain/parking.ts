export type PaymentStatus = 'not_required' | 'pending' | 'paid'
export type SessionStatus = 'parked' | 'pending_payment' | 'ready_to_leave' | 'left'
export type Direction = 'entry' | 'exit'

export interface PricingRule {
  freeMinutes: number
  hourlyRateFen: number
  dailyCapFen: number
}

export interface ParkingEvent {
  eventId: string
  sessionId: string | null
  direction: Direction
  plateNo: string
  laneId: string
  capturedAt: string
  confidence: number | null
  recognitionSource: 'demo' | 'manual' | 'api' | 'ftp'
  plateColor?: string | null
  providerRequestId?: string | null
}

export interface ParkingSession {
  sessionId: string
  plateNo: string
  entryEventId: string
  entryAt: string
  entryLaneId: string
  exitEventId: string | null
  exitAt: string | null
  exitLaneId: string | null
  durationMinutes: number | null
  amountFen: number | null
  paymentStatus: PaymentStatus
  status: SessionStatus
  paidAt: string | null
  leftAt: string | null
}

export interface ParkingException {
  exceptionId: string
  eventId: string
  plateNo: string
  laneId: string
  type: 'duplicate_entry' | 'entry_not_found'
  occurredAt: string
  status: 'open' | 'resolved'
  resolutionReason?: string
  resolvedAt?: string
}

export const DEFAULT_RULE: PricingRule = {
  freeMinutes: 15,
  hourlyRateFen: 500,
  dailyCapFen: 4000,
}

export function isValidPlate(plate: string): boolean {
  return /^[\u4e00-\u9fa5][A-Z][A-Z0-9]{5,6}$/.test(plate.trim().toUpperCase())
}

export function durationInMinutes(entryAt: string, exitAt: string): number {
  return Math.max(0, Math.ceil((Date.parse(exitAt) - Date.parse(entryAt)) / 60000))
}

export function calculateFee(durationMinutes: number, rule: PricingRule): number {
  if (durationMinutes <= rule.freeMinutes) return 0
  const fullDays = Math.floor(durationMinutes / 1440)
  const remainder = durationMinutes % 1440
  const remainderFee = remainder === 0 ? 0 : Math.min(Math.ceil(remainder / 60) * rule.hourlyRateFen, rule.dailyCapFen)
  return fullDays * rule.dailyCapFen + remainderFee
}

export function formatMoney(amountFen: number | null): string {
  return amountFen === null ? '—' : `¥${(amountFen / 100).toFixed(2)}`
}

export function formatDuration(minutes: number | null): string {
  if (minutes === null) return '—'
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  return [days ? `${days}天` : '', hours ? `${hours}小时` : '', `${mins}分钟`].filter(Boolean).join(' ')
}

export function formatTime(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(iso))
}

export function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
}
