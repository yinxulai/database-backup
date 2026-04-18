/**
 * Metrics Collector Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { MetricsCollector, getMetricsCollector } from './collector.js'

describe('MetricsCollector', () => {
  let collector: MetricsCollector

  beforeEach(() => {
    collector = MetricsCollector.getInstance()
    collector.reset()
  })

  describe('recordBackupCount', () => {
    it('should increment success counter', () => {
      collector.recordBackupCount('success')
      collector.recordBackupCount('success')
      collector.recordBackupCount('failed')

      const output = collector.toPrometheusFormat()
      expect(output).toContain('backup_total{status="success"} 2')
      expect(output).toContain('backup_total{status="failed"} 1')
    })
  })

  describe('recordBackupDuration', () => {
    it('should record duration for histogram', () => {
      collector.recordBackupDuration('test-task', 1.5)
      collector.recordBackupDuration('test-task', 2.3)
      collector.recordBackupDuration('other-task', 0.8)

      const output = collector.toPrometheusFormat()
      expect(output).toContain('backup_duration_seconds_bucket{task_name="test-task"')
      expect(output).toContain('backup_duration_seconds_sum{task_name="test-task"} 3.8')
      expect(output).toContain('backup_duration_seconds_count{task_name="test-task"} 2')
    })

    it('should compute histogram buckets correctly', () => {
      collector.recordBackupDuration('fast-task', 0.1)
      collector.recordBackupDuration('fast-task', 0.05)
      collector.recordBackupDuration('slow-task', 15)

      const output = collector.toPrometheusFormat()
      expect(output).toContain('backup_duration_seconds_bucket{task_name="fast-task",le="+Inf"} 2')
    })
  })

  describe('recordBackupSize', () => {
    it('should record backup size gauge', () => {
      collector.recordBackupSize('task-1', 1024)
      collector.recordBackupSize('task-2', 2048)

      const output = collector.toPrometheusFormat()
      expect(output).toContain('backup_size_bytes{task_name="task-1"} 1024')
      expect(output).toContain('backup_size_bytes{task_name="task-2"} 2048')
    })

    it('should update size when same task backed up again', () => {
      collector.recordBackupSize('task-1', 1024)
      collector.recordBackupSize('task-1', 2048)

      const output = collector.toPrometheusFormat()
      expect(output).toContain('backup_size_bytes{task_name="task-1"} 2048')
    })
  })

  describe('recordBackupSuccessTimestamp', () => {
    it('should record last success timestamp gauge', () => {
      collector.recordBackupSuccessTimestamp('task-1', 1713440000)
      collector.recordBackupSuccessTimestamp('task-2', 1713440100)

      const output = collector.toPrometheusFormat()
      expect(output).toContain('backup_last_success_timestamp{task_name="task-1"} 1713440000')
      expect(output).toContain('backup_last_success_timestamp{task_name="task-2"} 1713440100')
    })
  })

  describe('toPrometheusFormat', () => {
    it('should output valid Prometheus text format', () => {
      collector.recordBackupCount('success')
      collector.recordBackupDuration('test-task', 1.0)
      collector.recordBackupSize('test-task', 1024)
      collector.recordBackupSuccessTimestamp('test-task', 1713440000)

      const output = collector.toPrometheusFormat()

      expect(output).toContain('# HELP backup_total Total number of backup attempts')
      expect(output).toContain('# TYPE backup_total counter')
      expect(output).toContain('# HELP backup_duration_seconds Backup duration in seconds')
      expect(output).toContain('# TYPE backup_duration_seconds histogram')
      expect(output).toContain('# HELP backup_size_bytes Size of the last backup in bytes')
      expect(output).toContain('# TYPE backup_size_bytes gauge')
      expect(output).toContain('# HELP backup_last_success_timestamp Unix timestamp of last successful backup')
      expect(output).toContain('# TYPE backup_last_success_timestamp gauge')
    })

    it('should handle empty collector', () => {
      const output = collector.toPrometheusFormat()
      expect(output).toContain('# HELP backup_total')
      expect(output).toContain('# TYPE backup_total counter')
      expect(output).toContain('# HELP backup_duration_seconds')
      expect(output).toContain('# HELP backup_size_bytes')
      expect(output).toContain('# HELP backup_last_success_timestamp')
    })
  })

  describe('snapshot', () => {
    it('should return current metrics snapshot', () => {
      collector.recordBackupCount('success')
      collector.recordBackupDuration('test-task', 1.5)
      collector.recordBackupSize('test-task', 2048)
      collector.recordBackupSuccessTimestamp('test-task', 1713440000)

      const snapshot = collector.snapshot()

      expect(snapshot.timestamp).toBeDefined()
      expect(snapshot.counters).toHaveLength(1)
      expect(snapshot.counters[0]?.name).toBe('backup_total')
      expect(snapshot.counters[0]?.value).toBe(1)

      expect(snapshot.histograms).toHaveLength(1)
      expect(snapshot.histograms[0]?.name).toBe('backup_duration_seconds')
      expect(snapshot.histograms[0]?.values).toContain(1.5)

      expect(snapshot.gauges).toHaveLength(2)
    })
  })

  describe('reset', () => {
    it('should clear all metrics', () => {
      collector.recordBackupCount('success')
      collector.recordBackupDuration('task', 1.0)
      collector.recordBackupSize('task', 1024)

      collector.reset()

      const output = collector.toPrometheusFormat()
      expect(output).not.toContain('backup_total{status="success"} 1')
      expect(output).not.toContain('backup_duration_seconds_sum')
    })
  })
})

describe('getMetricsCollector', () => {
  it('should return singleton instance', () => {
    const instance1 = getMetricsCollector()
    const instance2 = getMetricsCollector()
    expect(instance1).toBe(instance2)
  })
})
