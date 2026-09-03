<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Bar, Column, Pie, Scatter, type Plot } from '@antv/g2plot'

export type G2PlotKind = 'column' | 'bar' | 'pie' | 'scatter'

const props = withDefaults(
  defineProps<{
    kind: G2PlotKind
    data: Record<string, unknown>[]
    /** Plot-specific options merged on top of the shared MioAni theme. */
    options?: Record<string, unknown>
    height?: number
  }>(),
  {
    options: () => ({}),
    height: 240,
  },
)

const hostRef = ref<HTMLDivElement | null>(null)
let plot: Plot<any> | null = null
let lastKind: G2PlotKind | null = null

function readCssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function themeBase() {
  const accent = readCssVar('--accent', '#b8f05f')
  const muted = readCssVar('--muted', '#8f9791')
  const ink = readCssVar('--ink', '#e8ece7')
  const line = readCssVar('--line', 'rgba(255,255,255,.08)')
  return {
    accent,
    muted,
    ink,
    line,
    palette: [accent, '#91d9eb', '#f0c36f', '#f09595', '#c4b5fd', '#7dd3a8'],
  }
}

function sharedOptions(container: HTMLElement) {
  const theme = themeBase()
  const withAxes = props.kind !== 'pie'
  return {
    container,
    autoFit: true,
    data: props.data,
    height: props.height,
    padding: 'auto' as const,
    theme: {
      background: 'transparent',
    },
    color: theme.palette,
    legend: {
      itemName: {
        style: { fill: theme.muted, fontSize: 12 },
      },
    },
    ...(withAxes
      ? {
          xAxis: {
            label: { style: { fill: theme.muted, fontSize: 11 } },
            line: { style: { stroke: theme.line } },
            tickLine: null,
            grid: null,
          },
          yAxis: {
            label: { style: { fill: theme.muted, fontSize: 11 } },
            grid: { line: { style: { stroke: theme.line, lineDash: [3, 3] } } },
          },
        }
      : {}),
    tooltip: {
      domStyles: {
        'g2-tooltip': {
          background: 'rgba(18,21,19,.94)',
          color: theme.ink,
          boxShadow: '0 8px 24px rgba(0,0,0,.35)',
          border: `1px solid ${theme.line}`,
          borderRadius: '8px',
          fontSize: '12px',
        },
      },
    },
  }
}

function createPlot(container: HTMLElement): Plot<any> {
  const base = sharedOptions(container)
  const options = { ...base, ...props.options, data: props.data, height: props.height }
  switch (props.kind) {
    case 'column':
      return new Column(container, options as any)
    case 'bar':
      return new Bar(container, options as any)
    case 'pie':
      return new Pie(container, options as any)
    case 'scatter':
      return new Scatter(container, options as any)
    default:
      return new Column(container, options as any)
  }
}

function render() {
  const el = hostRef.value
  if (!el) return
  if (plot && lastKind === props.kind) {
    try {
      plot.update({ ...props.options, data: props.data, height: props.height })
      return
    } catch {
      plot.destroy()
      plot = null
    }
  }
  plot?.destroy()
  el.innerHTML = ''
  plot = createPlot(el)
  lastKind = props.kind
  plot.render()
}

onMounted(() => {
  render()
})

watch(
  () => [props.kind, props.data, props.options, props.height] as const,
  () => {
    render()
  },
  { deep: true },
)

onBeforeUnmount(() => {
  plot?.destroy()
  plot = null
})
</script>

<template>
  <div ref="hostRef" class="g2plot-chart" :style="{ minHeight: `${height}px` }" />
</template>

<style scoped>
.g2plot-chart {
  width: 100%;
  min-width: 0;
}
</style>
