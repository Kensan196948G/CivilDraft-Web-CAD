/**
 * 構造化ロガー。
 *
 * 本番では Workers の console へ JSON 行として出力し、Cloudflare Workers
 * Observability で収集可能な形式とする。開発モードでは可読性を優先する。
 *
 * ログレベル: debug < info < warn < error（OTel severity に準拠）。
 * 全ログ行に correlationId を付与し、Workers API のリクエスト単位でトレース可能にする。
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

export interface LogEntry {
  readonly timestamp: string
  readonly level: LogLevel
  readonly message: string
  readonly correlationId?: string
  readonly [key: string]: unknown
}

export interface Logger {
  debug(message: string, extra?: Record<string, unknown>): void
  info(message: string, extra?: Record<string, unknown>): void
  warn(message: string, extra?: Record<string, unknown>): void
  error(message: string, extra?: Record<string, unknown>): void
  child(bindings: Record<string, unknown>): Logger
  setLevel(level: LogLevel): void
}

class ConsoleLogger implements Logger {
  private minLevel: number
  private readonly bindings: Record<string, unknown>

  constructor(minLevel: LogLevel = 'info', bindings: Record<string, unknown> = {}) {
    this.minLevel = LOG_LEVEL_ORDER[minLevel]
    this.bindings = { ...bindings }
  }

  setLevel(level: LogLevel): void {
    this.minLevel = LOG_LEVEL_ORDER[level]
  }

  child(bindings: Record<string, unknown>): Logger {
    return new ConsoleLogger(
      LOG_LEVEL_ORDER[this.minLevel as unknown as keyof typeof LOG_LEVEL_ORDER]
        ? (Object.entries(LOG_LEVEL_ORDER).find(([, v]) => v === this.minLevel)?.[0] as LogLevel)
        : 'info',
      { ...this.bindings, ...bindings },
    )
  }

  debug(message: string, extra?: Record<string, unknown>): void {
    this.log('debug', message, extra)
  }

  info(message: string, extra?: Record<string, unknown>): void {
    this.log('info', message, extra)
  }

  warn(message: string, extra?: Record<string, unknown>): void {
    this.log('warn', message, extra)
  }

  error(message: string, extra?: Record<string, unknown>): void {
    this.log('error', message, extra)
  }

  private log(level: LogLevel, message: string, extra?: Record<string, unknown>): void {
    if (LOG_LEVEL_ORDER[level] < this.minLevel) return

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.bindings,
      ...(extra ?? {}),
    }

    if (import.meta.env.DEV || typeof import.meta === 'undefined') {
      // 開発モード: 人間可読形式
      const prefix = `[${entry.timestamp}] [${level.toUpperCase()}]`
      const ctx = entry.correlationId ? ` [corr=${entry.correlationId}]` : ''
      const fmt = `${prefix}${ctx} ${message}`

      switch (level) {
        case 'debug':
          console.debug(fmt, extra ?? '')
          return
        case 'info':
          console.info(fmt, extra ?? '')
          return
        case 'warn':
          console.warn(fmt, extra ?? '')
          return
        case 'error':
          console.error(fmt, extra ?? '')
          return
      }
    }

    // 本番モード: JSON 行出力（Cloudflare Workers Observability 対応）
    const line = JSON.stringify(entry)
    switch (level) {
      case 'debug':
        console.debug(line)
        break
      case 'info':
        console.info(line)
        break
      case 'warn':
        console.warn(line)
        break
      case 'error':
        console.error(line)
        break
    }
  }
}

/** デフォルトのシングルトンロガー。アプリ全体で共有する。 */
export const defaultLogger: Logger = new ConsoleLogger(
  import.meta.env.PROD ? 'info' : 'debug',
)

/** 指定された correlationId を持つ子ロガーを作成する。Workers API のリクエスト単位で使用する。 */
export function createRequestLogger(correlationId: string): Logger {
  return defaultLogger.child({ correlationId })
}