<template>
  <div class="radar-panel" v-if="radar">
    <div class="radar-title">🎯 TACTICAL MATRIX / 六维战术矩阵</div>
    <div ref="radarChart" class="radar-container"></div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch, onUnmounted } from 'vue';
import * as echarts from 'echarts/core';
import { RadarComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { RadarChart } from 'echarts/charts';

echarts.use([RadarComponent, TooltipComponent, LegendComponent, RadarChart, CanvasRenderer]);

const props = defineProps<{ radar: any }>();
const radarChart = ref<HTMLElement | null>(null);
let chartInstance: any = null;

const computeMaxIndicator = (homeArr: number[], awayArr: number[]) => {
  const names = ['进攻火力', '防守抗压', '量化身价', '状态动量', '大赛经验', '体能储备'];
  return names.map((name, i) => {
    const maxVal = Math.max(homeArr?.[i] || 0, awayArr?.[i] || 0, 10);
    return { name, max: Math.ceil(maxVal * 1.15) };
  });
};

function initChart() {
  if (!radarChart.value || !props.radar) return;
  chartInstance = echarts.init(radarChart.value);

  const homeData = props.radar.home || [0, 0, 0, 0, 0, 0];
  const awayData = props.radar.away || [0, 0, 0, 0, 0, 0];
  const indicators = computeMaxIndicator(homeData, awayData);

  chartInstance.setOption({
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(8, 14, 28, 0.95)',
      borderColor: 'rgba(56, 189, 248, 0.3)',
      textStyle: { color: '#cbd5e1', fontSize: 11, fontFamily: 'monospace' },
      borderWidth: 1,
    },
    legend: {
      icon: 'circle', itemWidth: 8, itemHeight: 8, itemGap: 24,
      top: '0%', left: 'center',
      textStyle: { color: '#94a3b8', fontSize: 11, fontFamily: 'monospace', fontWeight: 'bold' },
    },
    radar: {
      indicator: indicators,
      shape: 'polygon',
      radius: '68%',
      center: ['50%', '55%'],
      splitNumber: 4,
      axisLine: { lineStyle: { color: 'rgba(51, 65, 85, 0.3)', width: 1 } },
      splitLine: {
        lineStyle: {
          color: ['rgba(30,41,59,0.2)', 'rgba(51,65,85,0.4)', 'rgba(51,65,85,0.6)', 'rgba(56,189,248,0.25)'],
          width: 1,
        },
      },
      axisName: { color: '#64748b', fontSize: 10, fontFamily: 'monospace', formatter: (v: string) => '// ' + v },
      splitArea: { show: false },
    },
    series: [{
      type: 'radar',
      symbol: 'circle',
      symbolSize: 4,
      data: [
        {
          value: homeData,
          name: props.radar.homeName || 'HOME',
          itemStyle: { color: '#38bdf8' },
          lineStyle: { width: 2, color: '#38bdf8', shadowBlur: 8, shadowColor: '#38bdf8' },
          areaStyle: {
            color: new (echarts as any).graphic.RadialGradient(0.5, 0.5, 0.5, [
              { offset: 0, color: 'rgba(56,189,248,0.03)' },
              { offset: 1, color: 'rgba(56,189,248,0.2)' },
            ]),
          },
        },
        {
          value: awayData,
          name: props.radar.awayName || 'AWAY',
          itemStyle: { color: '#f43f5e' },
          lineStyle: { width: 2, color: '#f43f5e', shadowBlur: 8, shadowColor: '#f43f5e' },
          areaStyle: {
            color: new (echarts as any).graphic.RadialGradient(0.5, 0.5, 0.5, [
              { offset: 0, color: 'rgba(244,63,94,0.02)' },
              { offset: 1, color: 'rgba(244,63,94,0.18)' },
            ]),
          },
        },
      ],
    }],
  });
}

watch(() => props.radar, () => { if (chartInstance) chartInstance.dispose(); initChart(); }, { deep: true });
const handleResize = () => { if (chartInstance) chartInstance.resize(); };

onMounted(() => { initChart(); window.addEventListener('resize', handleResize); });
onUnmounted(() => { window.removeEventListener('resize', handleResize); if (chartInstance) chartInstance.dispose(); });
</script>

<style scoped>
.radar-panel { background: rgba(8,14,28,0.97); border: 1px solid rgba(56,189,248,0.12); border-radius: 14px; padding: 14px; margin-bottom: 12px; }
.radar-title { font-size: 12px; font-weight: 700; color: #38bdf8; letter-spacing: 1px; margin-bottom: 4px; }
.radar-container { width: 100%; height: 260px; }
</style>
