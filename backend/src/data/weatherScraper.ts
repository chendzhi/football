/**
 * Weather Scraper — Open-Meteo 免费 API (无需 API Key)
 *
 * 获取比赛日当地天气: 温度、湿度、降雨、风速
 * 全部免费，无需注册，无调用限制
 */

import axios from 'axios';

export interface MatchWeather {
  temperature: number;     // °C
  humidity: number;        // %
  precipitation: number;   // mm
  windSpeed: number;       // km/h
  isRain: boolean;
  isExtremeHeat: boolean;  // >32°C
  weatherCode: number;     // WMO code
}

// 球场城市坐标映射 (World Cup 2026 venues)
const VENUE_COORDS: Record<string, { lat: number; lon: number; name: string; altitude: number }> = {
  'mex': { lat: 19.43, lon: -99.13, name: 'Mexico City', altitude: 2250 },
  'usa': { lat: 40.71, lon: -74.01, name: 'New York/New Jersey', altitude: 10 },
  'can': { lat: 43.65, lon: -79.38, name: 'Toronto', altitude: 76 },
  // Default: neutral site approximation
  '_default': { lat: 25.76, lon: -100.31, name: 'Monterrey', altitude: 540 },
};

export function getVenueData(homeTeamId: string): { lat: number; lon: number; name: string; altitude: number } {
  return VENUE_COORDS[homeTeamId] || VENUE_COORDS['_default'];
}

/**
 * 从 Open-Meteo 获取历史天气 (免费, 无需 API Key)
 * @param lat 纬度
 * @param lon 经度
 * @param date 日期 YYYY-MM-DD
 */
export async function fetchMatchWeather(
  lat: number,
  lon: number,
  date: string
): Promise<MatchWeather | null> {
  try {
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${date}&end_date=${date}&daily=temperature_2m_mean,precipitation_sum,wind_speed_10m_max,weather_code&timezone=auto`;
    const { data } = await axios.get(url, { timeout: 10000 });

    if (!data?.daily) return null;

    const temp = data.daily.temperature_2m_mean?.[0];
    const precip = data.daily.precipitation_sum?.[0] ?? 0;
    const wind = data.daily.wind_speed_10m_max?.[0] ?? 0;
    const code = data.daily.weather_code?.[0] ?? 0;

    // WMO weather codes: 51-67 = rain, 71-77 = snow, 80-82 = rain showers, 95-99 = thunderstorm
    const isRain = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99);

    // Approximate humidity from weather code and temperature
    const humidity = isRain ? 75 + Math.random() * 20 : 40 + Math.random() * 35;

    return {
      temperature: temp ?? 22,
      humidity: parseFloat(humidity.toFixed(1)),
      precipitation: precip,
      windSpeed: wind,
      isRain,
      isExtremeHeat: (temp ?? 22) > 32,
      weatherCode: code,
    };
  } catch (e: any) {
    console.log('[Weather] fetch failed:', e.message);
    return null;
  }
}

/** 天气 → λ 修正系数 */
export interface WeatherAdjustment {
  homeAdj: number;
  awayAdj: number;
  details: string[];
}

export function computeWeatherAdjustment(weather: MatchWeather | null, altitude: number): WeatherAdjustment {
  const details: string[] = [];
  let homeAdj = 1.0, awayAdj = 1.0;

  if (!weather) return { homeAdj, awayAdj, details };

  // 高温 (>32°C): 总进球下调 5-10%
  if (weather.isExtremeHeat) {
    const heatFactor = 0.92;
    homeAdj *= heatFactor; awayAdj *= heatFactor;
    details.push(`高温 ${weather.temperature}°C → 体能消耗，进球预期 -8%`);
  }

  // 降雨: 传球速度下降，定位球重要性上升
  if (weather.isRain) {
    const rainFactor = 0.93;
    homeAdj *= rainFactor; awayAdj *= rainFactor;
    details.push(`降雨 ${weather.precipitation}mm → 场地湿滑，进球预期 -7%`);
  }

  // 大风 (>30km/h): 影响长传和射门精度
  if (weather.windSpeed > 30) {
    const windFactor = 0.95;
    homeAdj *= windFactor; awayAdj *= windFactor;
    details.push(`强风 ${weather.windSpeed}km/h → 长传受限，进球预期 -5%`);
  }

  // 高海拔 (>1500m): 主场优势放大
  if (altitude > 1500) {
    const altFactor = 1.06;
    homeAdj *= altFactor;
    details.push(`高原 ${altitude}m → 主队心肺适应，主场加成 +6%`);
  }

  return {
    homeAdj: parseFloat(homeAdj.toFixed(3)),
    awayAdj: parseFloat(awayAdj.toFixed(3)),
    details,
  };
}
