<template>
  <div class="explain-outer" v-if="explainData || !loading">
    <!-- ═══════════ COLLAPSIBLE HEADER ═══════════ -->
    <div class="explain-header" :class="{ 'header-glow': !expanded && explainData }" @click="expanded = !expanded">
      <div class="header-left">
        <span class="header-icon">🔬</span>
        <span class="header-title">EXPLAIN ENGINE / 归因解释矩阵</span>
        <span class="header-version">v5.2</span>
        <span class="header-new-badge" v-if="explainData">READY</span>
      </div>
      <div class="header-right">
        <span class="expand-hint" v-if="!expanded && !explainData">点击加载</span>
        <span class="expand-hint" v-else-if="!expanded && explainData">点击展开归因分析</span>
        <span class="expand-icon">{{ expanded ? '▾' : '▸' }}</span>
      </div>
    </div>

    <!-- ═══════════ EXPANDED CONTENT ═══════════ -->
    <div class="explain-body" v-if="expanded">
      <!-- Loading -->
      <div class="loading-row" v-if="loading">
        <span class="loading-icon">⚡</span>
        <span>归因引擎计算中...</span>
      </div>

      <template v-else-if="explainData">
        <!-- ═══ Section 1: λ Breakdown ═══ -->
        <div class="section">
          <div class="section-title">// λ BREAKDOWN / 进球预期归因分解</div>
          <div class="breakdown-grid">
            <!-- Home -->
            <div class="team-breakdown">
              <div class="team-label">
                🏠 {{ homeName }}
                <span class="lambda-val">λ = {{ explainData.lambdaBreakdown.home.final }}</span>
              </div>
              <div class="breakdown-row header-row">
                <span class="comp-name">组件</span>
                <span class="comp-pct">占比</span>
                <span class="comp-val">贡献值</span>
              </div>
              <div
                class="breakdown-row"
                v-for="d in explainData.lambdaBreakdown.home.details"
                :key="d.component"
              >
                <span class="comp-name">{{ d.component }}</span>
                <div class="comp-bar-wrap">
                  <div
                    class="comp-bar"
                    :style="{
                      width: Math.abs(d.percentage) + '%',
                      background: d.percentage > 0
                        ? 'linear-gradient(90deg, #3b82f6, #38bdf8)'
                        : 'linear-gradient(90deg, #ef4444, #f43f5e)',
                    }"
                  ></div>
                </div>
                <span class="comp-pct">{{ d.percentage }}%</span>
                <span class="comp-val">{{ d.absoluteContribution }}</span>
              </div>
            </div>

            <!-- Away -->
            <div class="team-breakdown">
              <div class="team-label">
                🚌 {{ awayName }}
                <span class="lambda-val">λ = {{ explainData.lambdaBreakdown.away.final }}</span>
              </div>
              <div class="breakdown-row header-row">
                <span class="comp-name">组件</span>
                <span class="comp-pct">占比</span>
                <span class="comp-val">贡献值</span>
              </div>
              <div
                class="breakdown-row"
                v-for="d in explainData.lambdaBreakdown.away.details"
                :key="d.component"
              >
                <span class="comp-name">{{ d.component }}</span>
                <div class="comp-bar-wrap">
                  <div
                    class="comp-bar"
                    :style="{
                      width: Math.abs(d.percentage) + '%',
                      background: d.percentage > 0
                        ? 'linear-gradient(90deg, #3b82f6, #38bdf8)'
                        : 'linear-gradient(90deg, #ef4444, #f43f5e)',
                    }"
                  ></div>
                </div>
                <span class="comp-pct">{{ d.percentage }}%</span>
                <span class="comp-val">{{ d.absoluteContribution }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- ═══ Section 2: Poisson Active ═══ -->
        <div class="section">
          <div class="section-title">
            // POISSON ACTIVE / 泊松进球期望分布 &nbsp;
            <span class="formula-hint">P(k) = (λ^k · e^{-λ}) / k!</span>
          </div>
          <div class="poisson-grid">
            <div class="poisson-team">
              <div class="poisson-label">🏠 {{ homeName }}</div>
              <div class="poisson-bars">
                <div class="poisson-row" v-for="(p, k) in explainData.poissonDist.home" :key="'h'+k">
                  <span class="goal-label">{{ k }} 球</span>
                  <div class="poisson-bar-wrap">
                    <div
                      class="poisson-bar home-bar"
                      :style="{ width: (p * 100 * 3).toFixed(1) + '%' }"
                    ></div>
                  </div>
                  <span class="poisson-pct">{{ (p * 100).toFixed(1) }}%</span>
                </div>
              </div>
            </div>
            <div class="poisson-team">
              <div class="poisson-label">🚌 {{ awayName }}</div>
              <div class="poisson-bars">
                <div class="poisson-row" v-for="(p, k) in explainData.poissonDist.away" :key="'a'+k">
                  <span class="goal-label">{{ k }} 球</span>
                  <div class="poisson-bar-wrap">
                    <div
                      class="poisson-bar away-bar"
                      :style="{ width: (p * 100 * 3).toFixed(1) + '%' }"
                    ></div>
                  </div>
                  <span class="poisson-pct">{{ (p * 100).toFixed(1) }}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ═══ Section 3: Joint Probability Heatmap ═══ -->
        <div class="section">
          <div class="section-title">
            // JOINT PROBABILITY HEATMAP / 联合概率热力图 &nbsp;
            <span class="formula-hint">DIXON-COLES (ρ=-0.25) CORRECTED</span>
          </div>
          <div class="heatmap-legend">
            <span class="legend-item legend-home">■ 主胜区域</span>
            <span class="legend-item legend-draw">■ 平局对角</span>
            <span class="legend-item legend-away">■ 客胜区域</span>
          </div>
          <div class="heatmap-wrap">
            <table class="heatmap-table">
              <thead>
                <tr>
                  <th class="axis-label">主 \ 客</th>
                  <th v-for="y in 5" :key="y" class="col-header">
                    客 {{ y - 1 }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="x in 5" :key="x">
                  <td class="row-header">主 {{ x - 1 }}</td>
                  <td
                    v-for="y in 5"
                    :key="y"
                    :style="heatCellStyle(
                      explainData.poissonMatrix.displayMatrix[x-1][y-1],
                      explainData.poissonMatrix.regionIndicators[x-1][y-1]
                    )"
                    class="heat-cell"
                  >
                    {{ (explainData.poissonMatrix.displayMatrix[x-1][y-1] * 100).toFixed(1) }}%
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- ═══ Section 4: Feature Contribution ═══ -->
        <div class="section">
          <div class="section-title">// FEATURE SENSITIVITY / 特征敏感性排名 (±10% 扰动)</div>
          <div class="contrib-list">
            <div
              class="contrib-item"
              v-for="f in explainData.featureContribution.features"
              :key="f.featureKey"
            >
              <div class="contrib-top">
                <span class="contrib-name">{{ f.feature }}</span>
                <span
                  class="contrib-delta"
                  :class="f.deltaHomeWin > 0 ? 'delta-positive' : 'delta-negative'"
                >
                  主胜 Δ{{ (f.deltaHomeWin * 100).toFixed(2) }}%
                </span>
              </div>
              <div class="contrib-delta-bar-wrap">
                <div class="contrib-delta-track">
                  <div
                    class="contrib-delta-fill"
                    :style="{
                      width: Math.abs(f.deltaHomeWin) * 300 + '%',
                      marginLeft: f.deltaHomeWin < 0 ? 'auto' : '0',
                      background: f.deltaHomeWin > 0
                        ? 'linear-gradient(90deg, #22c55e, #16a34a)'
                        : 'linear-gradient(90deg, #ef4444, #dc2626)',
                    }"
                  ></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ═══ Section 5: Pipeline Logs ═══ -->
        <div class="section">
          <div class="section-title">// PIPELINE LOGS / 计算管道日志</div>
          <div class="terminal-body">
            <div class="log-line" v-for="log in explainData.pipelineLogs" :key="log">
              {{ log }}
            </div>
          </div>
        </div>
      </template>

      <!-- No data -->
      <div class="empty-hint" v-else @click="emit('load-explain', matchId || '')">
        <span class="click-hint">点击加载归因分析 (Click to load explanation)</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import type { ExplainResponse } from '../types';

const props = defineProps<{
  explainData: ExplainResponse | null;
  loading?: boolean;
  homeName?: string;
  awayName?: string;
  matchId?: string;
}>();

const emit = defineEmits<{
  'load-explain': [matchId: string];
}>();

const expanded = ref(true); // auto-expand when data loads

// 当传入新数据时自动展开
watch(
  () => props.explainData,
  (data) => {
    if (data) expanded.value = true;
  }
);

// 首次展开时触发加载
watch(expanded, (val) => {
  if (val && !props.explainData && !props.loading && props.matchId) {
    emit('load-explain', props.matchId);
  }
});

function heatCellStyle(prob: number, region: string) {
  const intensity = Math.min(prob * 8, 1); // scale for visibility
  let bg = '';
  let border = '';
  if (region === 'home') {
    bg = `rgba(59, 130, 246, ${0.1 + intensity * 0.5})`;
    border = '1px solid rgba(59, 130, 246, 0.4)';
  } else if (region === 'away') {
    bg = `rgba(239, 68, 68, ${0.1 + intensity * 0.5})`;
    border = '1px solid rgba(239, 68, 68, 0.4)';
  } else {
    bg = `rgba(148, 163, 184, ${0.1 + intensity * 0.5})`;
    border = '1px solid rgba(148, 163, 184, 0.4)';
  }
  return {
    background: bg,
    border,
    fontWeight: prob > 0.08 ? '700' : '400',
  };
}
</script>

<style scoped>
.explain-outer {
  width: 100%;
  margin: 0 0 18px 0;
  border: 1px solid rgba(56, 189, 248, 0.18);
  border-radius: 16px;
  background: rgba(8, 14, 28, 0.97);
  overflow: hidden;
}

/* ── Header ── */
.explain-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px;
  cursor: pointer;
  transition: background 0.2s;
  user-select: none;
}
.explain-header:hover {
  background: rgba(56, 189, 248, 0.05);
}
.explain-header.header-glow {
  box-shadow: inset 0 0 20px rgba(56, 189, 248, 0.08);
  border-bottom: 1px solid rgba(56, 189, 248, 0.25);
}
.header-new-badge {
  font-size: 9px;
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
  padding: 1px 7px;
  border-radius: 6px;
  font-weight: 700;
  letter-spacing: 1px;
  animation: pulse 2s infinite;
}
.expand-hint {
  font-size: 10px;
  color: #64748b;
  margin-right: 6px;
  font-family: monospace;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.header-icon { font-size: 16px; }
.header-title {
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 1px;
  color: #38bdf8;
}
.header-version {
  font-size: 10px;
  background: rgba(56, 189, 248, 0.18);
  color: #38bdf8;
  padding: 1px 8px;
  border-radius: 8px;
  font-weight: 700;
}
.header-right { color: #64748b; }
.expand-icon { font-size: 14px; }

/* ── Body ── */
.explain-body {
  padding: 0 20px 20px;
}

/* ── Sections ── */
.section {
  margin-bottom: 18px;
}
.section-title {
  font-size: 11px;
  font-weight: 700;
  color: #38bdf8;
  letter-spacing: 0.5px;
  margin-bottom: 10px;
}
.formula-hint {
  font-size: 9px;
  color: #64748b;
  font-weight: 400;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
}

/* ── Loading ── */
.loading-row {
  color: #94a3b8;
  font-size: 12px;
  padding: 20px 0;
  text-align: center;
}
.loading-icon { margin-right: 6px; }

/* ── λ Breakdown Grid ── */
.breakdown-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.team-breakdown {
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid rgba(56, 189, 248, 0.1);
  border-radius: 10px;
  padding: 12px;
}
.team-label {
  font-size: 12px;
  font-weight: 700;
  color: #e2e8f0;
  margin-bottom: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.lambda-val {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  color: #38bdf8;
  font-size: 13px;
}
.breakdown-row {
  display: grid;
  grid-template-columns: 1fr 60px 40px 40px;
  gap: 6px;
  align-items: center;
  padding: 4px 0;
  font-size: 10px;
}
.breakdown-row.header-row {
  color: #64748b;
  font-weight: 600;
  border-bottom: 1px solid rgba(56, 189, 248, 0.1);
  margin-bottom: 4px;
  padding-bottom: 6px;
}
.comp-name {
  color: #94a3b8;
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.comp-bar-wrap {
  height: 4px;
  background: rgba(30, 41, 59, 0.6);
  border-radius: 2px;
  overflow: hidden;
}
.comp-bar {
  height: 100%;
  border-radius: 2px;
  min-width: 1px;
}
.comp-pct {
  color: #e2e8f0;
  font-family: monospace;
  text-align: right;
  font-size: 10px;
}
.comp-val {
  color: #64748b;
  font-family: monospace;
  text-align: right;
  font-size: 10px;
}

/* ── Poisson ── */
.poisson-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.poisson-team {
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid rgba(56, 189, 248, 0.1);
  border-radius: 10px;
  padding: 12px;
}
.poisson-label {
  font-size: 11px;
  font-weight: 700;
  color: #e2e8f0;
  margin-bottom: 8px;
}
.poisson-bars { display: flex; flex-direction: column; gap: 5px; }
.poisson-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.goal-label {
  width: 28px;
  font-size: 10px;
  color: #64748b;
  text-align: right;
  font-family: monospace;
}
.poisson-bar-wrap {
  flex: 1;
  height: 8px;
  background: rgba(30, 41, 59, 0.6);
  border-radius: 4px;
  overflow: hidden;
}
.poisson-bar {
  height: 100%;
  border-radius: 4px;
  min-width: 2px;
}
.home-bar { background: linear-gradient(90deg, #1d4ed8, #38bdf8); }
.away-bar { background: linear-gradient(90deg, #dc2626, #f43f5e); }
.poisson-pct {
  width: 42px;
  font-size: 10px;
  color: #38bdf8;
  font-family: monospace;
  font-weight: 600;
}

/* ── Heatmap ── */
.heatmap-legend {
  display: flex;
  gap: 16px;
  margin-bottom: 10px;
  font-size: 10px;
}
.legend-item { font-family: monospace; }
.legend-home { color: #3b82f6; }
.legend-draw { color: #94a3b8; }
.legend-away { color: #ef4444; }

.heatmap-wrap { overflow-x: auto; }
.heatmap-wrap { overflow-x: auto; }
.heatmap-table {
  width: 100%;
  min-width: 300px;
  border-collapse: collapse;
  text-align: center;
}
.heatmap-table th,
.heatmap-table td {
  padding: 8px 4px;
  font-size: 11px;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
}
.axis-label {
  color: #64748b;
  font-size: 10px !important;
}
.col-header {
  color: #ef4444;
  font-size: 10px;
  font-weight: 600;
}
.row-header {
  color: #3b82f6;
  font-size: 10px;
  font-weight: 600;
}
.heat-cell {
  border-radius: 4px;
  transition: all 0.2s;
  color: #e2e8f0;
}
.heat-cell:hover {
  transform: scale(1.05);
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.3);
}

/* ── Feature Contribution ── */
.contrib-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.contrib-item {
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid rgba(56, 189, 248, 0.08);
  border-radius: 8px;
  padding: 8px 12px;
}
.contrib-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.contrib-name {
  font-size: 11px;
  color: #e2e8f0;
  font-weight: 600;
}
.contrib-delta {
  font-size: 10px;
  font-family: monospace;
  font-weight: 700;
}
.delta-positive { color: #22c55e; }
.delta-negative { color: #ef4444; }

.contrib-delta-bar-wrap { margin-top: 4px; }
.contrib-delta-track {
  width: 100%;
  height: 6px;
  background: rgba(30, 41, 59, 0.6);
  border-radius: 3px;
  overflow: hidden;
  position: relative;
}
.contrib-delta-fill {
  height: 100%;
  border-radius: 3px;
  min-width: 2px;
  transition: width 0.3s;
}

/* ── Terminal ── */
.terminal-body {
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(56, 189, 248, 0.08);
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.log-line {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 10px;
  color: #22c55e;
  opacity: 0.85;
  word-break: break-all;
}

/* ── Empty ── */
.empty-hint {
  text-align: center;
  padding: 16px 0;
  cursor: pointer;
}
.click-hint {
  color: #38bdf8;
  font-size: 11px;
  font-family: monospace;
  border-bottom: 1px dashed rgba(56, 189, 248, 0.4);
  padding-bottom: 2px;
}

/* ── Responsive ── */
@media (max-width: 800px) {
  .breakdown-grid,
  .poisson-grid {
    grid-template-columns: 1fr;
  }
}
</style>
