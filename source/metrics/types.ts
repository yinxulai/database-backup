/**
 * Prometheus Metrics Types
 */

export type MetricType = 'counter' | 'histogram' | 'gauge'

export interface MetricMetadata {
  name: string
  help: string
  labels?: Record<string, string>
}

export interface CounterMetric extends MetricMetadata {
  type: 'counter'
  value: number
}

export interface HistogramMetric extends MetricMetadata {
  type: 'histogram'
  values: number[]
  buckets?: number[]
}

export interface GaugeMetric extends MetricMetadata {
  type: 'gauge'
  value: number
}

export interface BackupCounterLabels {
  status: 'success' | 'failed'
}

export interface BackupHistogramLabels {
  taskName: string
}

export interface BackupGaugeLabels {
  taskName: string
}

export interface ExpositionLine {
  name: string
  value: number
  labels: Record<string, string>
}

export interface MetricsSnapshot {
  timestamp: string
  counters: CounterMetric[]
  histograms: HistogramMetric[]
  gauges: GaugeMetric[]
}
