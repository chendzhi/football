<template>
  <div
    class="match-card"
    :class="{ 'is-selected': isSelected }"
    @click="$emit('select', match)"
  >
    <div class="match-meta">
      <div>{{ formatStage(match.groupName) }}</div>
      <div>{{ formatMatchTime(match.matchDate) }}</div>
    </div>
    <div class="match-teams">
      <div class="team-short">
        <img
          class="team-flag"
          :src="match.homeTeam.flagUrl"
          :alt="match.homeTeam.shortName"
          @error="onFlagError"
        />
        <div>
          <div class="team-name">{{ match.homeTeam.shortName }}</div>
          <div class="team-china">{{ getChinaName(match.homeTeam.name) }}</div>
        </div>
      </div>
      <div class="vs" v-if="!isCompleted">vs</div>
      <div class="score-display" v-else>
        <span class="score-num">{{ match.homeScore }}</span>
        <span class="score-div">:</span>
        <span class="score-num">{{ match.awayScore }}</span>
      </div>
      <div class="team-short">
        <img
          class="team-flag"
          :src="match.awayTeam.flagUrl"
          :alt="match.awayTeam.shortName"
          @error="onFlagError"
        />
        <div>
          <div class="team-name">{{ match.awayTeam.shortName }}</div>
          <div class="team-china">{{ getChinaName(match.awayTeam.name) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Match } from '../types';
import { getChinaName, formatStage, formatMatchTime } from '../team-names';

const props = defineProps<{
  match: Match;
  isSelected: boolean;
}>();

defineEmits<{
  select: [match: Match];
}>();

const isCompleted = computed(() =>
  props.match.status === 'completed' && props.match.homeScore != null && props.match.awayScore != null
);

function onFlagError(e: Event) {
  (e.target as HTMLImageElement).style.display = 'none';
}
</script>

<style scoped>
.match-card {
  background: rgba(30, 41, 59, 0.85);
  border: 1px solid transparent;
  border-radius: 18px;
  padding: 18px;
  cursor: pointer;
  transition: transform 0.2s ease, background 0.2s ease, border-color 0.2s ease;
}
.match-card:hover {
  transform: translateY(-2px);
  background: rgba(51, 65, 85, 0.95);
}
.match-card.is-selected {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.12);
}
.match-meta {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12px;
  color: #94a3b8;
  font-size: 13px;
}
.match-teams {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.team-short {
  display: flex;
  gap: 10px;
  align-items: center;
}
.team-short > div {
  display: flex;
  flex-direction: column;
}
.team-flag {
  width: 32px;
  height: 22px;
  object-fit: contain;
  border-radius: 2px;
  flex-shrink: 0;
}
.team-name {
  font-size: 15px;
  font-weight: 700;
}
.team-china {
  color: #94a3b8;
  font-size: 12px;
}
.vs {
  color: #38bdf8;
  font-weight: 700;
  font-size: 14px;
}
.score-display {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.score-num {
  font-size: 20px;
  font-weight: 900;
  color: #f0f9ff;
  font-variant-numeric: tabular-nums;
  background: rgba(34, 197, 94, 0.2);
  padding: 2px 8px;
  border-radius: 6px;
}
.score-div {
  color: #64748b;
  font-weight: 700;
  font-size: 16px;
}
</style>
