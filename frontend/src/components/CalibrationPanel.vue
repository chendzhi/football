<template>
  <div class="cal-panel" v-if="report">
    <div class="cal-title">📊 CALIBRATION DASHBOARD / 模型校准仪表盘</div>

    <!-- Summary Row -->
    <div class="cal-summary">
      <div class="stat" v-for="s in summary" :key="s.label">
        <div class="stat-label">{{ s.label }}</div>
        <div class="stat-value" :class="s.color">{{ s.value }}</div>
      </div>
    </div>

    <!-- Error Buckets -->
    <div class="cal-section">
      <div class="section-title">Error Analysis / 误差分析</div>
      <div class="error-msg" v-if="report.errorAnalysis">{{ report.errorAnalysis.summary }}</div>
      <div class="bucket-list" v-if="report.errorAnalysis">
        <div class="bucket-row" v-for="b in report.errorAnalysis.buckets" :key="b.bin">
          <span class="bucket-label">{{ b.bin }}</span>
          <span class="bucket-bar-wrap">
            <span class="bucket-bar-pred" :style="{ width: b.avgPred * 100 + '%' }"></span>
            <span class="bucket-bar-actual" :style="{ width: b.avgActual * 100 + '%' }">●</span>
          </span>
          <span class="bucket-vals">Pred {{ (b.avgPred * 100).toFixed(0) }}% · Actual {{ (b.avgActual * 100).toFixed(0) }}%</span>
          <span class="bucket-bias" :class="b.bias > 0.05 ? 'over' : b.bias < -0.05 ? 'under' : 'good'">
            {{ b.bias > 0.05 ? '⚠ 高估' : b.bias < -0.05 ? '📈 低估' : '✓ 准确' }}
          </span>
          <span class="bucket-count">n={{ b.count }}</span>
        </div>
      </div>
    </div>

    <!-- Rolling Window -->
    <div class="cal-section" v-if="report.rollingWindow && report.rollingWindow.length > 0">
      <div class="section-title">Rolling Brier / 滑动窗口趋势</div>
      <div class="rolling-chart">
        <div class="rolling-bar" v-for="(rw, i) in report.rollingWindow" :key="i"
          :style="{ height: Math.max(4, (1 - rw.brier) * 80) + 'px' }"
          :title="'W' + rw.window + ': Brier=' + rw.brier + ' Acc=' + (rw.accuracy * 100).toFixed(0) + '%'">
        </div>
      </div>
      <div class="rolling-labels">
        <span>W1</span>
        <span>W{{ report.rollingWindow.length }}</span>
      </div>
    </div>

    <!-- Model Versions -->
    <div class="cal-section" v-if="report.modelComparison && report.modelComparison.length > 0">
      <div class="section-title">Model Versions / 模型版本对比</div>
      <div class="version-row header">
        <span>版本</span><span>场次</span><span>Brier</span><span>准确率</span>
      </div>
      <div class="version-row" v-for="mv in report.modelComparison" :key="mv.modelVersion">
        <span>{{ mv.modelVersion }}</span>
        <span>{{ mv.count }}</span>
        <span>{{ mv.brier }}</span>
        <span>{{ (mv.accuracy * 100).toFixed(1) }}%</span>
      </div>
    </div>

    <div class="cal-footer">
      <button class="refresh-btn" @click="load">🔄 刷新</button>
      <span class="last-update">更新: {{ lastUpdate }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

interface BacktestReport {
  stats: { total: number; brier: number; logLoss: number; accuracy: number; roi: number; profit: number };
  errorAnalysis: { buckets: Array<{ bin: string; avgPred: number; avgActual: number; bias: number; count: number }>; summary: string };
  rollingWindow: Array<{ window: number; brier: number; accuracy: number }>;
  modelComparison: Array<{ modelVersion: string; count: number; brier: number; accuracy: number }>;
}

const report = ref<BacktestReport | null>(null);
const lastUpdate = ref('');

const summary = computed(() => {
  if (!report.value) return [];
  const s = report.value.stats;
  return [
    { label: 'Total 样本', value: String(s.total) + ' 场', color: '' },
    { label: 'Brier 布氏', value: s.brier.toFixed(3), color: s.brier < 0.3 ? 'green' : s.brier < 0.5 ? 'yellow' : 'red' },
    { label: 'Accuracy 准确率', value: (s.accuracy * 100).toFixed(1) + '%', color: '' },
    { label: 'ROI 回报率', value: (s.roi * 100).toFixed(1) + '%', color: s.roi > 0 ? 'green' : 'red' },
    { label: 'P/L 盈亏', value: (s.profit > 0 ? '+' : '') + s.profit.toFixed(1) + 'u', color: s.profit > 0 ? 'green' : 'red' },
  ];
});

async function load() {
  try {
    const res = await fetch('/api/backtest?t=' + Date.now());
    report.value = await res.json();
    lastUpdate.value = new Date().toLocaleTimeString();
  } catch { /* backend may not be ready */ }
}

onMounted(load);
</script>

<style scoped>
.cal-panel {
  background: rgba(8, 14, 28, 0.97);
  border: 1px solid rgba(56, 189, 248, 0.12);
  border-radius: 16px;
  padding: 20px;
  color: #e2e8f0;
  font-size: 13px;
}
.cal-title {
  font-size: 14px;
  font-weight: 700;
  color: #38bdf8;
  letter-spacing: 1px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(56,189,248,0.15);
}

/* Summary */
.cal-summary { display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
.stat { background: rgba(20,28,48,0.8); border-radius: 10px; padding: 10px 14px; text-align: center; min-width: 70px; }
.stat-label { font-size: 11px; color: #64748b; }
.stat-value { font-size: 16px; font-weight: 700; margin-top: 2px; }
.stat-value.green { color: #22c55e; }
.stat-value.red { color: #ef4444; }
.stat-value.yellow { color: #eab308; }

/* Sections */
.cal-section { margin-bottom: 16px; }
.section-title { font-size: 11px; color: #94a3b8; letter-spacing: 1px; margin-bottom: 8px; text-transform: uppercase; }
.error-msg { font-size: 12px; color: #eab308; margin-bottom: 8px; }

/* Buckets */
.bucket-list { display: flex; flex-direction: column; gap: 4px; }
.bucket-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
.bucket-label { width: 55px; font-size: 10px; color: #64748b; }
.bucket-bar-wrap { flex: 1; height: 8px; background: rgba(30,41,59,0.6); border-radius: 4px; position: relative; overflow: hidden; }
.bucket-bar-pred { height: 100%; background: linear-gradient(90deg, #3b82f6, #60a5fa); border-radius: 4px; position: absolute; }
.bucket-bar-actual { position: absolute; left: 0; top: -3px; color: #22c55e; font-size: 10px; }
.bucket-vals { width: 140px; font-size: 10px; color: #94a3b8; }
.bucket-bias { width: 50px; font-size: 10px; }
.bucket-bias.over { color: #ef4444; }
.bucket-bias.under { color: #3b82f6; }
.bucket-bias.good { color: #22c55e; }
.bucket-count { font-size: 10px; color: #475569; width: 30px; }

/* Rolling */
.rolling-chart { display: flex; align-items: flex-end; gap: 2px; height: 60px; margin: 8px 0; }
.rolling-bar { flex: 1; background: linear-gradient(0deg, #3b82f6, #38bdf8); border-radius: 2px 2px 0 0; min-width: 6px; }
.rolling-labels { display: flex; justify-content: space-between; font-size: 10px; color: #475569; }

/* Versions */
.version-row { display: flex; gap: 8px; padding: 3px 0; font-size: 11px; }
.version-row.header { color: #64748b; border-bottom: 1px solid rgba(56,189,248,0.1); margin-bottom: 4px; }
.version-row span { flex: 1; }

.cal-footer { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
.refresh-btn { background: rgba(56,189,248,0.15); border: 1px solid rgba(56,189,248,0.3); color: #38bdf8; padding: 6px 14px; border-radius: 8px; cursor: pointer; font-size: 11px; }
.last-update { font-size: 10px; color: #475569; }
</style>
