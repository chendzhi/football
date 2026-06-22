<template>
  <div class="tree-panel" v-if="paths">
    <div class="tree-title">
      <span>🌳 MATCH SCRIPT / 比分推演</span>
      <span class="tree-badge">{{ paths.source || 'Monte Carlo' }}</span>
    </div>
    <div class="script-cards">
      <div class="script-card" v-for="(label, key) in labels" :key="key"
        :class="'card-' + key">
        <div class="card-label">{{ label }}</div>
        <div class="card-score">{{ paths[key]?.fullScore || '?' }}</div>
        <div class="card-prob">{{ (paths[key]?.fullProb * 100).toFixed(1) }}%</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ paths: any }>();
const p = computed(() => props.paths || {});

const labels: Record<string, string> = {
  main: '🎯 主战',
  backup: '🛡️ 僵持',
  variable: '⚡ 冷门',
};
</script>

<style scoped>
.tree-panel {
  background: rgba(8,14,28,0.97);
  border: 1px solid rgba(56,189,248,0.12);
  border-radius: 14px;
  padding: 14px;
  margin-bottom: 12px;
}
.tree-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; font-weight: 700; color: #38bdf8;
  letter-spacing: 1px; margin-bottom: 12px;
}
.tree-badge {
  font-size: 10px; background: rgba(59,130,246,0.2);
  color: #60a5fa; padding: 2px 8px; border-radius: 8px;
}
.script-cards {
  display: flex; gap: 10px;
}
.script-card {
  flex: 1; text-align: center;
  padding: 12px 8px; border-radius: 10px;
  background: rgba(15,23,42,0.7);
  border: 1px solid rgba(56,189,248,0.08);
}
.card-main { border-color: rgba(59,130,246,0.3); }
.card-backup { border-color: rgba(148,163,184,0.3); }
.card-variable { border-color: rgba(239,68,68,0.3); }
.card-label {
  font-size: 11px; color: #64748b; margin-bottom: 6px;
}
.card-score {
  font-size: 22px; font-weight: 900; font-family: 'Cascadia Code', monospace;
}
.card-main .card-score { color: #60a5fa; }
.card-backup .card-score { color: #94a3b8; }
.card-variable .card-score { color: #f87171; }
.card-prob {
  font-size: 12px; color: #38bdf8; margin-top: 4px; font-weight: 600;
}
</style>
