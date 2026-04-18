/**
 * Prometheus Metrics Collector
 * Implements Prometheus text exposition format for backup metrics.
 */

import type {
  CounterMetric,
  HistogramMetric,
  GaugeMetric,
  MetricsSnapshot,
} from './types.js'

const DEFAULT_HISTOGRAM_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60]

export class MetricsCollector {
  private static instance: MetricsCollector | null = null

  private backupCounters = new Map<string, { success: number; failed: number }>()
  private backupHistograms = new Map<string, number[]>()
  private histogramBuckets = DEFAULT_HISTOGRAM_BUCKETS
  private backupSizeBytes = new Map<string, number>()
  private backupLastSuccessTimestamp = new Map<string, number>()

  private constructor() {}

  static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector()
    }
    return MetricsCollector.instance
  }

  reset(): void {
    this.backupCounters.clear()
    this.backupHistograms.clear()
    this.backupSizeBytes.clear()
    this.backupLastSuccessTimestamp.clear()
  }

  recordBackupCount(status: 'success' | 'failed'): void {
    const key = 'backup_total'
    const current = this.backupCounters.get(key) ?? { success: 0, failed: 0 }
    if (status === 'success') {
      current.success++
    } else {
      current.failed++
    }
    this.backupCounters.set(key, current)
  }

  recordBackupDuration(taskName: string, durationSeconds: number): void {
    const key = taskName
    const current = this.backupHistograms.get(key) ?? []
    current.push(durationSeconds)
    this.backupHistograms.set(key, current)
  }

  recordBackupSize(taskName: string, sizeBytes: number): void {
    this.backupSizeBytes.set(taskName, sizeBytes)
  }

  recordBackupSuccessTimestamp(taskName: string, timestamp: number): void {
    this.backupLastSuccessTimestamp.set(taskName, timestamp)
  }

  private formatCounters(): string[] {
    const lines: string[] = []
    lines.push('# HELP backup_total Total number of backup attempts')
    lines.push('# TYPE backup_total counter')
    
    for (const [, counts] of this.backupCounters) {
      lines.push(`backup_total{status="success"} ${counts.success}`)
      lines.push(`backup_total{status="failed"} ${counts.failed}`)
    }
    
    return lines
  }

  private formatHistograms(): string[] {
    const lines: string[] = []
    lines.push('# HELP backup_duration_seconds Backup duration in seconds')
    lines.push('# TYPE backup_duration_seconds histogram')
    
    for (const [taskName, values] of this.backupHistograms) {
      const buckets = this.computeHistogramBuckets(values)
      const labels = `task_name="${taskName}"`
      
      for (const [boundary, count] of buckets) {
        lines.push(`backup_duration_seconds_bucket{${labels},le="${boundary}"} ${count}`)
      }
      lines.push(`backup_duration_seconds_bucket{${labels},le="+Inf"} ${values.length}`)
      const sum = values.reduce((a, b) => a + b, 0)
      lines.push(`backup_duration_seconds_sum{${labels}} ${sum}`)
      lines.push(`backup_duration_seconds_count{${labels}} ${values.length}`)
    }
    
    return lines
  }

  private computeHistogramBuckets(values: number[]): Map<number, number> {
    const buckets = new Map<number, number>()
    for (const boundary of this.histogramBuckets) {
      let count = 0
      for (const v of values) {
        if (v <= boundary) count++
      }
      buckets.set(boundary, count)
    }
    return buckets
  }

  private formatGauges(): string[] {
    const lines: string[] = []
    
    lines.push('# HELP backup_size_bytes Size of the last backup in bytes')
    lines.push('# TYPE backup_size_bytes gauge')
    for (const [taskName, size] of this.backupSizeBytes) {
      lines.push(`backup_size_bytes{task_name="${taskName}"} ${size}`)
    }
    
    lines.push('# HELP backup_last_success_timestamp Unix timestamp of last successful backup')
    lines.push('# TYPE backup_last_success_timestamp gauge')
    for (const [taskName, timestamp] of this.backupLastSuccessTimestamp) {
      lines.push(`backup_last_success_timestamp{task_name="${taskName}"} ${timestamp}`)
    }
    
    return lines
  }

  toPrometheusFormat(): string {
    const allLines: string[] = []
    allLines.push(...this.formatCounters())
    allLines.push('')
    allLines.push(...this.formatHistograms())
    allLines.push('')
    allLines.push(...this.formatGauges())
    allLines.push('')
    return allLines.join('\n')
  }

  snapshot(): MetricsSnapshot {
    const counters: CounterMetric[] = []
    for (const [name, counts] of this.backupCounters) {
      counters.push({
        name,
        type: 'counter',
        help: 'Total number of backup attempts',
        value: counts.success + counts.failed,
      })
    }

    const histograms: HistogramMetric[] = []
    for (const [taskName, values] of this.backupHistograms) {
      histograms.push({
        name: 'backup_duration_seconds',
        type: 'histogram',
        help: 'Backup duration in seconds',
        labels: { taskName },
        values,
        buckets: this.histogramBuckets,
      })
    }

    const gauges: GaugeMetric[] = []
    for (const [taskName, size] of this.backupSizeBytes) {
      gauges.push({
        name: 'backup_size_bytes',
        type: 'gauge',
        help: 'Size of the last backup in bytes',
        labels: { taskName },
        value: size,
      })
    }
    for (const [taskName, timestamp] of this.backupLastSuccessTimestamp) {
      gauges.push({
        name: 'backup_last_success_timestamp',
        type: 'gauge',
        help: 'Unix timestamp of last successful backup',
        labels: { taskName },
        value: timestamp,
      })
    }

    return {
      timestamp: new Date().toISOString(),
      counters,
      histograms,
      gauges,
    }
  }
}

export function getMetricsCollector(): MetricsCollector {
  return MetricsCollector.getInstance()
}
