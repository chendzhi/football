<template>
  <div class="panel-card">
    <!-- Header -->
    <div class="panel-header">
      <div>
        <div class="panel-title">📅 MATCH SCHEDULE / 世界杯赛程列表</div>
      </div>
      <div class="search-box">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="🔍 搜索球队..."
          class="search-input"
        />
      </div>
    </div>

    <!-- Matches Grouped by Date -->
    <div class="match-list">
      <template v-for="group in groupedMatches" :key="group.name">
        <div class="date-header">
          <span class="date-icon">📅</span>
          <span class="date-text">{{ formatDateHeader(group.name) }}</span>
          <span class="date-count">{{ group.matches.length }} matches</span>
        </div>
        <div
          v-for="match in group.matches"
          :key="match.id"
          :id="'match-'+match.id"
          class="match-card"
          :class="{ 'is-selected': selectedMatchId === match.id }"
          @click="selectMatch(match)"
        >
          <div class="card-top">
            <span class="card-time">⏱️ {{ formatMatchTime(match.matchDate) }}</span>
            <span class="card-stage">{{ match.groupName }}</span>
          </div>
          <div class="card-teams">
            <div class="card-team home-team">
              <img class="card-flag" :src="match.homeTeam.flagUrl" @error="onFlagError" />
              <div class="card-team-info">
                <div class="card-team-name">{{ match.homeTeam.name }}</div>
                <div class="card-team-cn">{{ getChinaName(match.homeTeam.name) }}</div>
              </div>
              <span class="card-elo">ELO: {{ match.homeTeam.eloRating }}</span>
            </div>
            <div class="card-vs">vs</div>
            <div class="card-team away-team">
              <img class="card-flag" :src="match.awayTeam.flagUrl" @error="onFlagError" />
              <div class="card-team-info">
                <div class="card-team-name">{{ match.awayTeam.name }}</div>
                <div class="card-team-cn">{{ getChinaName(match.awayTeam.name) }}</div>
              </div>
              <span class="card-elo">ELO: {{ match.awayTeam.eloRating }}</span>
            </div>
          </div>
        </div>
      </template>

      <div class="no-results" v-if="groupedMatches.length === 0">
        无匹配结果
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import type { Match } from '../types';
import { getChinaName, formatStage, formatMatchTime } from '../team-names';

const emit = defineEmits<{ 'select-match': [match: Match] }>();

const matches = ref<Match[]>([]);
const selectedMatchId = ref<string | null>(null);
const searchQuery = ref('');
const matchListRef = ref<HTMLElement | null>(null);

function scrollToMatch(matchId: string) {
  nextTick(() => {
    const el = document.getElementById('match-' + matchId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

onMounted(async () => {
  const res = await fetch('/api/matches');
  const data = await res.json();
  matches.value = data;
  // Auto-select first upcoming (scheduled) match
  const upcoming = data.find((m: Match) => m.status === 'scheduled');
  const target = upcoming || data[0];
  if (target) {
    selectedMatchId.value = target.id;
    emit('select-match', target);
    scrollToMatch(target.id);
  }
});

function selectMatch(match: Match) {
  selectedMatchId.value = match.id;
  emit('select-match', match);
}

/** Format date for header: "June 14, 2026 (Saturday)" */
function formatDateHeader(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00+08:00');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} · ${days[d.getUTCDay()]}`;
}

/** Group matches by date (YYYY-MM-DD) */
const groupedMatches = computed(() => {
  const q = searchQuery.value.toLowerCase().trim();
  let filtered = matches.value;
  if (q) {
    filtered = matches.value.filter(m =>
      m.homeTeam.name.toLowerCase().includes(q) ||
      m.awayTeam.name.toLowerCase().includes(q) ||
      getChinaName(m.homeTeam.name).includes(q) ||
      getChinaName(m.awayTeam.name).includes(q)
    );
  }

  // Group by Beijing date (UTC+8)
  const groups = new Map<string, Match[]>();
  for (const m of filtered) {
    const bj = new Date(new Date(m.matchDate).getTime() + 8 * 3600 * 1000);
    const key = bj.toISOString().slice(0, 10);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }

  // Sort groups by date, sort matches within each group by time
  const result = [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, items]) => ({
      name,
      matches: items.sort((a, b) => a.matchDate.localeCompare(b.matchDate)),
    }));
  return result;
});

function onFlagError(e: Event) {
  (e.target as HTMLImageElement).style.display = 'none';
}
</script>

<style scoped>
.panel-card {
  background: rgba(8, 14, 28, 0.97);
  border: 1px solid rgba(56, 189, 248, 0.12);
  border-radius: 20px;
  padding: 24px;
  color: #e2e8f0;
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
}

/* ── Header ── */
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid rgba(56, 189, 248, 0.15);
  flex-wrap: wrap;
  gap: 12px;
  flex-shrink: 0;
}
.panel-title {
  font-size: 16px;
  font-weight: 700;
  color: #f0f9ff;
  letter-spacing: 0.5px;
}
.search-box { flex-shrink: 0; }
.search-input {
  background: rgba(30, 41, 59, 0.7);
  border: 1px solid rgba(56, 189, 248, 0.2);
  color: #e2e8f0;
  padding: 7px 14px;
  border-radius: 20px;
  font-size: 12px;
  width: 180px;
  outline: none;
  transition: border-color 0.2s;
}
.search-input:focus { border-color: #38bdf8; }
.search-input::placeholder { color: #475569; }

/* ── Match List ── */
.match-list {
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.match-list::-webkit-scrollbar { width: 4px; }
.match-list::-webkit-scrollbar-thumb { background: rgba(56, 189, 248, 0.2); border-radius: 2px; }

/* ── Date Header ── */
.date-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
  color: #38bdf8;
  letter-spacing: 0.5px;
  padding: 14px 4px 6px;
  margin-top: 6px;
  border-bottom: 1px solid rgba(56, 189, 248, 0.12);
}
.date-icon { font-size: 14px; }
.date-text { flex: 1; }
.date-count {
  font-size: 10px;
  color: #64748b;
  font-weight: 400;
  background: rgba(30, 41, 59, 0.6);
  padding: 2px 8px;
  border-radius: 8px;
}

/* ── Match Card ── */
.match-card {
  background: rgba(20, 28, 48, 0.8);
  border: 1px solid rgba(56, 189, 248, 0.08);
  border-radius: 14px;
  padding: 14px 16px;
  cursor: pointer;
  transition: all 0.2s;
}
.match-card:hover {
  background: rgba(30, 45, 70, 0.85);
  border-color: rgba(56, 189, 248, 0.25);
  transform: translateX(3px);
}
.match-card.is-selected {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.1);
  box-shadow: 0 0 16px rgba(59, 130, 246, 0.15);
}
.card-top {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
  font-size: 11px;
}
.card-time { color: #94a3b8; font-size: 12px; font-weight: 500; }
.card-stage { color: #64748b; font-size: 11px; background: rgba(30,41,59,0.6); padding: 2px 8px; border-radius: 6px; }

.card-teams {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.card-team {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}
.away-team { flex-direction: row-reverse; text-align: right; }
.card-flag {
  width: 28px;
  height: 20px;
  object-fit: contain;
  border-radius: 2px;
  flex-shrink: 0;
}
.card-team-info {
  display: flex;
  flex-direction: column;
}
.away-team .card-team-info { align-items: flex-end; }
.card-team-name {
  font-size: 13px;
  font-weight: 700;
  color: #e2e8f0;
}
.card-team-cn {
  font-size: 11px;
  color: #94a3b8;
}
.card-elo {
  font-size: 10px;
  color: #38bdf8;
  font-family: monospace;
  white-space: nowrap;
}
.card-vs {
  color: #38bdf8;
  font-weight: 700;
  font-size: 12px;
  flex-shrink: 0;
}

.no-results {
  text-align: center;
  color: #475569;
  padding: 40px 0;
}
</style>
