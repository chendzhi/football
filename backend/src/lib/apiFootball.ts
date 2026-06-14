/**
 * API-Football v3 Client
 * 数据源: https://dashboard.api-football.com/
 */
import axios from 'axios';

const api = axios.create({
  baseURL: 'https://v3.football.api-sports.io',
  headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY || '' },
  timeout: 15000,
});

// ─── Fixtures ───
export async function getFixtures(league: number, season: number) {
  const { data } = await api.get('/fixtures', { params: { league, season } });
  return data.response;
}

// ─── Fixture Statistics (core!) ───
export async function getFixtureStats(fixtureId: number) {
  const { data } = await api.get('/fixtures/statistics', { params: { fixture: fixtureId } });
  return data.response;
}

// ─── Standings ───
export async function getStandings(league: number, season: number) {
  const { data } = await api.get('/standings', { params: { league, season } });
  return data.response;
}

// ─── Odds ───
export async function getOdds(fixtureId: number) {
  const { data } = await api.get('/odds', { params: { fixture: fixtureId } });
  return data.response;
}

// ─── Teams ───
export async function getTeams(league: number, season: number) {
  const { data } = await api.get('/teams', { params: { league, season } });
  return data.response;
}

// ─── Team Statistics ───
export async function getTeamStats(league: number, season: number, teamId: number) {
  const { data } = await api.get('/teams/statistics', { params: { league, season, team: teamId } });
  return data.response;
}
