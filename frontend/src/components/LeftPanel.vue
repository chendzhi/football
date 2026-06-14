<template>
  <div class="panel-card">
    <!-- ═══════════ HEADER ═══════════ -->
    <div class="engine-header">
      <div class="engine-title-row">
        <span class="engine-icon">🤖</span>
        <span class="engine-title">ANTIGRAVITY AI COGNITIVE ENGINE</span>
        <span class="engine-version">v5.0</span>
      </div>
      <div class="engine-subtitle">
        2026美加墨世界杯 · 量化精算版
        <span class="status-dot">●</span>
        <span class="status-label">POISSON ACTIVE</span>
      </div>
    </div>

    <!-- ═══════════ MATCH DISPLAY ═══════════ -->
    <div class="match-display" v-if="currentMatch">
      <div class="teams-row">
        <!-- Home -->
        <div class="team-col">
          <div class="team-tag">🏠 HOME / 主队</div>
          <div class="team-info">
            <img class="flag-img" :src="currentMatch.homeTeam.flagUrl" @error="onFlagError" />
            <div class="team-detail">
              <div class="team-name-en">{{ currentMatch.homeTeam.name }}</div>
              <div class="team-name-cn">{{ getChinaName(currentMatch.homeTeam.name) }}</div>
              <div class="team-elo">ELO: {{ currentMatch.homeTeam.eloRating }}</div>
            </div>
          </div>
        </div>
        <!-- Away -->
        <div class="team-col away-col">
          <div class="team-tag away-tag">客队 / AWAY 🚌</div>
          <div class="team-info away-info">
            <img class="flag-img" :src="currentMatch.awayTeam.flagUrl" @error="onFlagError" />
            <div class="team-detail">
              <div class="team-name-en">{{ currentMatch.awayTeam.name }}</div>
              <div class="team-name-cn">{{ getChinaName(currentMatch.awayTeam.name) }}</div>
              <div class="team-elo">ELO: {{ currentMatch.awayTeam.eloRating }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- VS / SCORE + PREDICT BUTTON -->
      <div class="action-row">
        <div class="loops-badge">{{ iterations.toLocaleString() }} LOOPS</div>
        <div class="vs-divider" v-if="!isMatchCompleted">
          <span class="vs-line"></span>
          <span class="vs-text">VS</span>
          <span class="vs-line"></span>
        </div>
        <div class="score-display-lg" v-else>
          <span class="score-big">{{ currentMatch.homeScore }}</span>
          <span class="score-colon">:</span>
          <span class="score-big">{{ currentMatch.awayScore }}</span>
          <span class="score-ft">FT</span>
        </div>
        <button class="predict-btn" :disabled="loading" @click="onPredict">
          {{ loading ? '⏳ COMPUTING...' : '⚡ Activate AI Predict / 激活 AI 预测' }}
        </button>
      </div>
    </div>

    <!-- Empty state -->
    <div class="empty-state" v-else>
      <div class="empty-icon">📡</div>
      <div>请从右侧赛程中选择一场比赛</div>
      <div class="empty-sub">Select a match to activate the AI prediction engine</div>
    </div>

    <!-- Error -->
    <div class="error-state" v-if="errorMessage">
      <div class="error-icon">⚠️</div>
      <div class="error-text">{{ errorMessage }}</div>
      <button class="retry-button" @click="onPredict">重试 Retry</button>
    </div>

    <!-- ═══════════ PREDICTION REPORT ═══════════ -->
    <div class="report-area" v-if="report && !errorMessage">
      <!-- Tactical Radar (replaces ELO numbers) -->
      <TacticalRadar :radar="radar" />

      <!-- Probability Bar -->
      <div class="prob-section">
        <div class="section-title">🎰 WIN PROBABILITY / 胜平负概率 DISTRIBUTION</div>
        <div class="prob-bar-wrapper">
          <div class="prob-bar">
            <div class="bar-segment bar-home" :style="{ width: (report.probabilities.homeWin * 100).toFixed(1) + '%' }"></div>
            <div class="bar-segment bar-draw" :style="{ width: (report.probabilities.draw * 100).toFixed(1) + '%' }"></div>
            <div class="bar-segment bar-away" :style="{ width: (report.probabilities.awayWin * 100).toFixed(1) + '%' }"></div>
          </div>
        </div>
        <div class="prob-labels">
          <span class="label-home">主胜 {{ (report.probabilities.homeWin * 100).toFixed(1) }}%</span>
          <span class="label-draw">平局 {{ (report.probabilities.draw * 100).toFixed(1) }}%</span>
          <span class="label-away">客胜 {{ (report.probabilities.awayWin * 100).toFixed(1) }}%</span>
        </div>
      </div>

      <!-- Prediction Tree (replaces static Top3) -->
      <PredictionTree :paths="paths" />

      <!-- Sandbox + AI Narrative side by side -->
      <div class="cards-row">
        <SandboxController @override-predict="(t) => emit('override-predict', t)" />
        <div class="mini-card">
          <div class="mini-card-title">🧠 AI COGNITIVE REPORT / 精算师裁决</div>
          <div class="narrative-text">{{ narrative || '认知引擎待命中，请激活 AI 预测...' }}</div>
          <div class="ou-row"><span>大小球 (2.5)</span><span class="ou-value"><span class="ou-over">OVER {{ (report.over25Prob * 100).toFixed(1) }}%</span> / <span class="ou-under">UNDER {{ (report.under25Prob * 100).toFixed(1) }}%</span></span></div>
          <div class="ou-row"><span>让球 ({{ formatSpread(report.spread.line) }})</span><span class="ou-value">COVER {{ (report.spread.coverProb * 100).toFixed(1) }}%</span></div>
        </div>
      </div>

      <!-- System Logs -->
      <div class="terminal-section">
        <div class="terminal-title">⚡ SYSTEM TERMINAL LOGS</div>
        <div class="terminal-body">
          <div class="log-line">>> [LAMBDA] 主队 λ: {{ report.lambdas.homeLambda }} | 客队 λ: {{ report.lambdas.awayLambda }}</div>
          <div class="log-line">>> [MC] Dixon-Coles (ρ=-0.12) + 时间切片 9×10min + noise floor 8%</div>
          <div class="log-line">>> [CALIBRATE] Platt + Isotonic 双校准已应用</div>
          <div class="log-line">>> [SNAPSHOT] 特征快照 + 预测记录已持久化</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Match, SimulationReport } from '../types';
import { getChinaName, formatStage } from '../team-names';
import TacticalRadar from './TacticalRadar.vue';
import PredictionTree from './PredictionTree.vue';
import SandboxController from './SandboxController.vue';

const props = defineProps<{
  currentMatch: Match | null;
  report: SimulationReport | null;
  loading: boolean;
  errorMessage: string | null;
  paths?: any; radar?: any; narrative?: string;
}>();

const emit = defineEmits<{ 'trigger-predict': [matchId: string]; 'override-predict': [tweaks: any] }>();

const iterations = 10000;
const isMatchCompleted = computed(() =>
  props.currentMatch?.status === 'completed' && props.currentMatch?.homeScore != null
);

function onPredict() {
  if (!props.currentMatch) return;
  emit('trigger-predict', props.currentMatch.id);
}

function formatSpread(line: number): string {
  if (Object.is(line, -0) || line === 0) return '0.00';
  return line > 0 ? `+${line.toFixed(2)}` : line.toFixed(2);
}

function onFlagError(e: Event) {
  (e.target as HTMLImageElement).style.display = 'none';
}
</script>

<style scoped>
.panel-card {
  background: rgba(8, 14, 28, 0.97);
  border: 1px solid rgba(56, 189, 248, 0.15);
  border-radius: 20px;
  padding: 28px;
  color: #e2e8f0;
  font-family: 'Segoe UI', system-ui, monospace;
}

/* ── Header ── */
.engine-header {
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid rgba(56, 189, 248, 0.2);
}
.engine-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.engine-icon { font-size: 22px; }
.engine-title {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 1px;
  color: #f0f9ff;
}
.engine-version {
  font-size: 12px;
  background: rgba(56, 189, 248, 0.2);
  color: #38bdf8;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 700;
}
.engine-subtitle {
  margin-top: 8px;
  font-size: 13px;
  color: #94a3b8;
  display: flex;
  align-items: center;
  gap: 8px;
}
.status-dot {
  color: #22c55e;
  font-size: 10px;
  animation: pulse 2s infinite;
}
.status-label {
  color: #22c55e;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1px;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* ── Match Display ── */
.match-display { margin-bottom: 20px; }
.teams-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.team-col { flex: 1; }
.away-col { text-align: right; }
.team-tag {
  font-size: 10px;
  color: #64748b;
  letter-spacing: 1px;
  margin-bottom: 10px;
  text-transform: uppercase;
}
.away-tag { text-align: right; }
.team-info {
  display: flex;
  align-items: center;
  gap: 12px;
}
.away-info {
  flex-direction: row-reverse;
}
.flag-img {
  width: 48px;
  height: 32px;
  object-fit: contain;
  border-radius: 3px;
  flex-shrink: 0;
}
.team-detail {
  display: flex;
  flex-direction: column;
}
.away-col .team-detail { align-items: flex-end; }
.team-name-en {
  font-size: 16px; font-weight: 700; color: #f1f5f9;
}
.team-name-cn {
  font-size: 14px; color: #94a3b8; margin-top: 2px;
}
.team-elo {
  font-size: 11px; color: #38bdf8; margin-top: 4px; font-family: monospace;
  background: rgba(56,189,248,0.08); padding: 2px 8px; border-radius: 4px; display: inline-block;
}

/* ── Action Row ── */
.action-row {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 10px;
  flex-wrap: wrap;
  justify-content: center;
}
.score-display-lg {
  display: flex;
  align-items: center;
  gap: 6px;
}
.score-big {
  font-size: 28px;
  font-weight: 900;
  color: #f0f9ff;
  font-variant-numeric: tabular-nums;
  background: rgba(34, 197, 94, 0.2);
  padding: 4px 12px;
  border-radius: 8px;
  border: 1px solid rgba(34, 197, 94, 0.4);
}
.score-colon {
  font-size: 24px;
  font-weight: 700;
  color: #64748b;
}
.score-ft {
  font-size: 10px;
  color: #22c55e;
  font-weight: 700;
  letter-spacing: 1px;
  background: rgba(34, 197, 94, 0.15);
  padding: 2px 6px;
  border-radius: 4px;
  margin-left: 4px;
}
.loops-badge {
  font-size: 11px;
  color: #64748b;
  font-family: monospace;
  letter-spacing: 2px;
  background: rgba(30, 41, 59, 0.6);
  padding: 4px 10px;
  border-radius: 6px;
}
.vs-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  justify-content: center;
}
.vs-line {
  flex: 1;
  height: 1px;
  background: rgba(56, 189, 248, 0.25);
}
.vs-text {
  font-weight: 900;
  color: #38bdf8;
  font-size: 16px;
  letter-spacing: 4px;
}
.predict-btn {
  background: linear-gradient(135deg, #2563eb, #38bdf8);
  border: none;
  color: #fff;
  padding: 12px 28px;
  border-radius: 999px;
  cursor: pointer;
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.5px;
  transition: all 0.2s;
  white-space: nowrap;
}
.predict-btn:hover:not(:disabled) {
  box-shadow: 0 0 24px rgba(56, 189, 248, 0.4);
  transform: scale(1.02);
}
.predict-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Empty / Error ── */
.empty-state {
  text-align: center;
  padding: 40px 0 20px;
  color: #64748b;
  font-size: 14px;
}
.empty-icon { font-size: 40px; margin-bottom: 12px; }
.empty-sub { font-size: 11px; margin-top: 6px; color: #475569; }
.error-state {
  background: rgba(220, 38, 38, 0.1);
  border: 1px solid rgba(220, 38, 38, 0.3);
  border-radius: 14px;
  padding: 20px;
  text-align: center;
  margin-bottom: 16px;
}
.error-icon { font-size: 28px; margin-bottom: 6px; }
.error-text { color: #fca5a5; font-size: 13px; margin-bottom: 12px; }
.retry-button {
  background: rgba(220, 38, 38, 0.2);
  border: 1px solid rgba(220, 38, 38, 0.4);
  color: #fca5a5;
  padding: 6px 18px;
  border-radius: 999px;
  cursor: pointer;
  font-size: 12px;
}

/* ── Probability Section ── */
.prob-section {
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid rgba(56, 189, 248, 0.12);
  border-radius: 14px;
  padding: 18px;
  margin-bottom: 18px;
}
.section-title {
  font-size: 13px;
  font-weight: 700;
  color: #38bdf8;
  letter-spacing: 1px;
  margin-bottom: 14px;
}
.prob-bar-wrapper {
  margin-bottom: 10px;
}
.prob-bar {
  display: flex;
  height: 10px;
  border-radius: 5px;
  overflow: hidden;
  background: rgba(30, 41, 59, 0.6);
}
.bar-home { background: linear-gradient(90deg, #1d4ed8, #3b82f6, #60a5fa); border-radius: 5px 0 0 5px; }
.bar-draw { background: linear-gradient(90deg, #475569, #64748b, #94a3b8); }
.bar-away { background: linear-gradient(90deg, #ef4444, #dc2626, #b91c1c); border-radius: 0 5px 5px 0; }
.prob-labels {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 600;
}
.label-home { color: #3b82f6; }
.label-draw { color: #94a3b8; }
.label-away { color: #ef4444; }

.narrative-text { color: #94a3b8; font-size: 12px; line-height: 1.6; margin-bottom: 12px; min-height: 50px; }
/* ── Cards Row ── */
.cards-row {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}
.mini-card {
  flex: 1;
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid rgba(56, 189, 248, 0.12);
  border-radius: 14px;
  padding: 16px;
}
.mini-card-title {
  font-size: 11px;
  font-weight: 700;
  color: #38bdf8;
  letter-spacing: 1px;
  margin-bottom: 12px;
}
.mini-card-body { display: flex; flex-direction: column; gap: 8px; }
.score-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: rgba(30, 41, 59, 0.5);
  border-radius: 8px;
}
.score-rank { color: #64748b; font-size: 11px; width: 22px; }
.score-num { font-size: 15px; font-weight: 700; flex: 1; }
.score-pct { color: #38bdf8; font-weight: 700; font-size: 13px; }
.ou-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  background: rgba(30, 41, 59, 0.5);
  border-radius: 8px;
  font-size: 12px;
}
.ou-over { color: #22c55e; font-weight: 600; }
.ou-under { color: #94a3b8; font-weight: 600; }
.ou-div { color: #475569; margin: 0 4px; }
.ou-value { font-family: monospace; }
.confidence-row { margin-top: 2px; }
.confidence-value {
  color: #38bdf8;
  font-weight: 700;
  font-size: 14px;
}

/* ── Terminal ── */
.terminal-section {
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(56, 189, 248, 0.1);
  border-radius: 12px;
  padding: 14px 16px;
}
.terminal-title {
  font-size: 10px;
  color: #22c55e;
  letter-spacing: 1px;
  margin-bottom: 10px;
  font-weight: 600;
}
.terminal-body { display: flex; flex-direction: column; gap: 5px; }
.log-line {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 11px;
  color: #22c55e;
  opacity: 0.85;
}
</style>
