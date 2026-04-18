
export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error'
  timestamp: string
  requestId: string
  message: string
  duration?: number
  metadata?: Record<string, unknown>
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

export interface Logger {
  debug(message: string, metadata?: Record<string, unknown>): void
  info(message: string, metadata?: Record<string, unknown>): void
  warn(message: string, metadata?: Record<string, unknown>): void
  error(message: string, metadata?: Record<string, unknown>): void
  child(requestId: string): Logger
}

export class DefaultLogger implements Logger {
  private level: LogLevel
  private requestId: string

  constructor(level: LogLevel = 'info', requestId?: string) {
    this.level = level
    this.requestId = requestId ?? generateRequestId()
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level]
  }

  private log(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return

    const entry: LogEntry = {
      level,
      timestamp: new Date().toISOString(),
      requestId: this.requestId,
      message,
    }

    if (metadata) {
      // Extract duration if present
      if ('duration' in metadata && typeof metadata.duration === 'number') {
        entry.duration = metadata.duration
        const { duration: _, ...rest } = metadata
        entry.metadata = rest
      } else {
        entry.metadata = metadata
      }
    }

    console.log(JSON.stringify(entry))
  }

  debug(message: string, metadata?: Record<string, unknown>): void {
    this.log('debug', message, metadata)
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    this.log('info', message, metadata)
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    this.log('warn', message, metadata)
  }

  error(message: string, metadata?: Record<string, unknown>): void {
    this.log('error', message, metadata)
  }

  child(requestId: string): Logger {
    return new DefaultLogger(this.level, requestId)
  }
}

function generateRequestId(): string {
  return Math.random().toString(36).substring(2, 15)
}

export function createLogger(level: LogLevel = 'info', requestId?: string): Logger {
  return new DefaultLogger(level, requestId)
}

// Default logger instance
export const logger = createLogger()
