<template>
  <div class="sandbox-panel">
    <div class="sandbox-title">
      <span>🎛️ COGNITIVE SANDBOX / 战术沙盘</span>
      <span class="sandbox-badge">MANUAL OVERRIDE</span>
    </div>
    <div class="slider-row">
      <div class="slider-label"><span>主队积极度</span><span class="val">{{ tweaks.homeMomentum.toFixed(2) }}x</span></div>
      <input type="range" min="0.8" max="1.3" step="0.05" v-model.number="tweaks.homeMomentum" class="slider blue" />
    </div>
    <div class="slider-row">
      <div class="slider-label"><span>客队疲劳度</span><span class="val red">{{ (100 - tweaks.awayFitness * 100).toFixed(0) }}%</span></div>
      <input type="range" min="0.7" max="1.0" step="0.05" v-model.number="tweaks.awayFitness" class="slider red" />
    </div>
    <div class="slider-row">
      <div class="slider-label"><span>裁判执法尺度</span><span class="val green">{{ tweaks.refereeStrictness === 1 ? '标准' : tweaks.refereeStrictness > 1 ? '严厉' : '宽松' }}</span></div>
      <input type="range" min="0.8" max="1.2" step="0.2" v-model.number="tweaks.refereeStrictness" class="slider green" />
    </div>
    <button class="override-btn" @click="emitOverride" :disabled="debouncing">
      {{ debouncing ? '⏳ 缓冲中...' : '⚡ 锁定变数 · 重新注入计算管道' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';

const tweaks = reactive({ homeMomentum: 1.0, awayFitness: 1.0, refereeStrictness: 1.0 });
const debouncing = ref(false);
let timer: any = null;

const emit = defineEmits<{ 'override-predict': [tweaks: typeof tweaks] }>();

function emitOverride() {
  if (debouncing.value) return;
  debouncing.value = true;
  clearTimeout(timer);
  timer = setTimeout(() => {
    emit('override-predict', { ...tweaks });
    debouncing.value = false;
  }, 500);
}
</script>

<style scoped>
.sandbox-panel { background: rgba(8,14,28,0.97); border: 1px solid rgba(56,189,248,0.12); border-radius: 14px; padding: 14px; margin-bottom: 12px; }
.sandbox-title { display: flex; align-items: center; justify-content: space-between; font-size: 11px; font-weight: 700; color: #38bdf8; letter-spacing: 1px; margin-bottom: 10px; }
.sandbox-badge { font-size: 9px; color: #475569; }
.slider-row { margin-bottom: 8px; }
.slider-label { display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8; margin-bottom: 2px; }
.slider-label .val { color: #38bdf8; font-weight: 600; }
.slider-label .val.red { color: #ef4444; }
.slider-label .val.green { color: #22c55e; }
.slider { width: 100%; height: 4px; border-radius: 2px; -webkit-appearance: none; appearance: none; background: #1e293b; outline: none; }
.slider::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; cursor: pointer; }
.slider.blue::-webkit-slider-thumb { background: #3b82f6; }
.slider.red::-webkit-slider-thumb { background: #ef4444; }
.slider.green::-webkit-slider-thumb { background: #22c55e; }
.override-btn { width: 100%; margin-top: 8px; padding: 10px; background: linear-gradient(135deg,#2563eb,#3b82f6); border: none; border-radius: 10px; color: #fff; font-weight: 700; font-size: 12px; cursor: pointer; transition: all .2s; }
.override-btn:hover:not(:disabled) { box-shadow: 0 0 20px rgba(59,130,246,0.4); }
.override-btn:disabled { opacity: .5; cursor: not-allowed; }
</style>
