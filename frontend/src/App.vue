<template>
  <div class="app-shell">
    <div class="left-panel">
      <LeftPanel
        :currentMatch="currentMatch"
        :report="predictionReport"
        :loading="isComputing"
        :errorMessage="predictionError"
        @trigger-predict="fetchPrediction"
      />
      <CalibrationPanel />
    </div>
    <div class="right-panel">
      <RightPanel @select-match="handleMatchSelect" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import LeftPanel from './components/LeftPanel.vue';
import RightPanel from './components/RightPanel.vue';
import CalibrationPanel from './components/CalibrationPanel.vue';
import type { Match, SimulationReport } from './types';

const currentMatch = ref<Match | null>(null);
const predictionReport = ref<SimulationReport | null>(null);
const isComputing = ref(false);
const predictionError = ref<string | null>(null);

function handleMatchSelect(match: Match) {
  currentMatch.value = match;
  predictionReport.value = null;
  predictionError.value = null;
}

async function fetchPrediction(matchId: string) {
  if (!matchId) return;
  isComputing.value = true;
  predictionError.value = null;
  try {
    const res = await fetch(`/api/predict/${matchId}?t=${Date.now()}`);
    if (!res.ok) {
      throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    predictionReport.value = data.report as SimulationReport;
  } catch (err) {
    predictionError.value = err instanceof Error
      ? `预测引擎暂时不可用: ${err.message}`
      : '预测引擎暂时不可用，请稍后重试。';
    predictionReport.value = null;
  } finally {
    isComputing.value = false;
  }
}
</script>

<style scoped>
.app-shell {
  display: flex;
  min-height: 100vh;
  background: #0b1120;
  color: #e2e8f0;
}
.left-panel {
  flex: 3;
  padding: 24px;
}
.right-panel {
  flex: 2;
  padding: 24px;
  border-left: 1px solid rgba(148, 163, 184, 0.12);
}
</style>
