<template>
  <div class="tree-panel" v-if="paths">
    <div class="tree-title">
      <span>🌳 MATCH SCRIPT TREE / 赛事剧本推演</span>
      <span class="tree-badge">AI</span>
    </div>
    <svg viewBox="0 0 620 200" class="tree-svg">
      <defs>
        <linearGradient id="gB" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#3b82f6"/><stop offset="100%" stop-color="#60a5fa"/></linearGradient>
        <linearGradient id="gR" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#ef4444"/><stop offset="100%" stop-color="#f87171"/></linearGradient>
      </defs>

      <!-- Connecting lines -->
      <g fill="none" stroke-width="1.5" opacity="0.5">
        <!-- KICKOFF → HT -->
        <line x1="55" y1="100" x2="195" y2="35" stroke="url(#gB)" stroke-dasharray="5 3" />
        <line x1="55" y1="100" x2="195" y2="100" stroke="#64748b" stroke-dasharray="5 3" />
        <line x1="55" y1="100" x2="195" y2="165" stroke="url(#gR)" stroke-dasharray="5 3" />
        <!-- HT → FT -->
        <line x1="270" y1="35" x2="410" y2="35" stroke="url(#gB)" stroke-dasharray="5 3" />
        <line x1="270" y1="100" x2="410" y2="100" stroke="#64748b" stroke-dasharray="5 3" />
        <line x1="270" y1="165" x2="410" y2="165" stroke="url(#gR)" stroke-dasharray="5 3" />
      </g>

      <!-- KICKOFF -->
      <circle cx="55" cy="100" r="7" fill="#6366f1" class="pulse-dot" stroke="#818cf8" stroke-width="2" />
      <text x="55" y="122" fill="#818cf8" text-anchor="middle" font-size="10" font-weight="700">KICK</text>
      <text x="55" y="134" fill="#64748b" text-anchor="middle" font-size="9">OFF</text>

      <!-- Half-Time Column -->
      <g v-for="(n,i) in htNodes" :key="'ht'+i">
        <rect :x="n.x" :y="n.y" width="80" height="30" rx="5" fill="#1e293b" :stroke="n.stroke" stroke-width="1.5" />
        <text :x="n.x+40" :y="n.y+13" :fill="n.color" text-anchor="middle" font-size="11" font-weight="700">HT {{ n.score }}</text>
        <text :x="n.x+40" :y="n.y+27" fill="#64748b" text-anchor="middle" font-size="9">{{ n.prob }}</text>
      </g>

      <!-- Full-Time Column -->
      <g v-for="(n,i) in ftNodes" :key="'ft'+i">
        <rect :x="n.x" :y="n.y" width="90" height="30" rx="5" fill="#0f172a" :stroke="n.stroke" stroke-width="1.5" />
        <text :x="n.x+45" :y="n.y+13" :fill="n.color" text-anchor="middle" font-size="11" font-weight="700">{{ n.label }}</text>
        <text :x="n.x+45" :y="n.y+27" :fill="n.stroke" text-anchor="middle" font-size="10" font-weight="600">{{ n.score }}</text>
      </g>

      <!-- Legend -->
      <rect x="5" y="175" width="8" height="8" rx="2" fill="#3b82f6" /><text x="16" y="183" fill="#64748b" font-size="9">主战</text>
      <rect x="60" y="175" width="8" height="8" rx="2" fill="#64748b" /><text x="71" y="183" fill="#64748b" font-size="9">僵持</text>
      <rect x="115" y="175" width="8" height="8" rx="2" fill="#ef4444" /><text x="126" y="183" fill="#64748b" font-size="9">冷门</text>
    </svg>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ paths: any }>();
const p = computed(() => props.paths || {});

const htNodes = computed(() => [
  { x:195, y:20, score: p.value.main?.halfScore||'1-0', prob: ((p.value.main?.halfProb||0.24)*100).toFixed(1)+'%', color:'#60a5fa', stroke:'#3b82f6' },
  { x:195, y:85, score: p.value.backup?.halfScore||'0-0', prob: ((p.value.backup?.halfProb||0.35)*100).toFixed(1)+'%', color:'#94a3b8', stroke:'#64748b' },
  { x:195, y:150, score: p.value.variable?.halfScore||'0-1', prob: ((p.value.variable?.halfProb||0.12)*100).toFixed(1)+'%', color:'#f87171', stroke:'#ef4444' },
]);

const ftNodes = computed(() => [
  { x:410, y:20, score: p.value.main?.fullScore||'2-0', label:'🎯 主战', color:'#60a5fa', stroke:'#3b82f6' },
  { x:410, y:85, score: p.value.backup?.fullScore||'1-1', label:'🛡️ 僵持', color:'#94a3b8', stroke:'#64748b' },
  { x:410, y:150, score: p.value.variable?.fullScore||'1-2', label:'⚡ 冷门', color:'#f87171', stroke:'#ef4444' },
]);
</script>

<style scoped>
.tree-panel { background: rgba(8,14,28,0.97); border: 1px solid rgba(56,189,248,0.12); border-radius: 14px; padding: 14px; margin-bottom: 12px; }
.tree-title { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; color: #38bdf8; letter-spacing: 1px; margin-bottom: 4px; }
.tree-badge { font-size: 10px; background: rgba(59,130,246,0.2); color: #60a5fa; padding: 2px 8px; border-radius: 8px; }
.tree-svg { width: 100%; height: auto; }
.pulse-dot { animation: pulse 2s infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
</style>
