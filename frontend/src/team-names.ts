/**
 * 2026 世界杯 48 队中英文名映射
 */
export const TEAM_CN: Record<string, string> = {
  // Group A
  'Mexico': '墨西哥',
  'South Korea': '韩国',
  'Czechia': '捷克',
  'South Africa': '南非',
  // Group B
  'Canada': '加拿大',
  'Bosnia & Herz.': '波黑',
  'Qatar': '卡塔尔',
  'Switzerland': '瑞士',
  // Group C
  'Brazil': '巴西',
  'Morocco': '摩洛哥',
  'Haiti': '海地',
  'Scotland': '苏格兰',
  // Group D
  'United States': '美国',
  'USA': '美国',
  'Paraguay': '巴拉圭',
  'Australia': '澳大利亚',
  'Turkiye': '土耳其',
  // Group E
  'Germany': '德国',
  'Ecuador': '厄瓜多尔',
  "Cote d'Ivoire": '科特迪瓦',
  'Curacao': '库拉索',
  // Group F
  'Netherlands': '荷兰',
  'Japan': '日本',
  'Sweden': '瑞典',
  'Tunisia': '突尼斯',
  // Group G
  'Belgium': '比利时',
  'Egypt': '埃及',
  'Iran': '伊朗',
  'New Zealand': '新西兰',
  // Group H
  'Spain': '西班牙',
  'Cape Verde': '佛得角',
  'Saudi Arabia': '沙特阿拉伯',
  'Uruguay': '乌拉圭',
  // Group I
  'France': '法国',
  'Senegal': '塞内加尔',
  'Iraq': '伊拉克',
  'Norway': '挪威',
  // Group J
  'Argentina': '阿根廷',
  'Algeria': '阿尔及利亚',
  'Austria': '奥地利',
  'Jordan': '约旦',
  // Group K
  'Portugal': '葡萄牙',
  'Colombia': '哥伦比亚',
  'DR Congo': '刚果(金)',
  'Uzbekistan': '乌兹别克斯坦',
  // Group L
  'England': '英格兰',
  'Croatia': '克罗地亚',
  'Ghana': '加纳',
  'Panama': '巴拿马',
};

export function getChinaName(englishName: string): string {
  return TEAM_CN[englishName] || englishName;
}

/** 格式化赛段名 */
export function formatStage(raw: string): string {
  const m = raw.match(/Group Stage\s*-\s*(\d+)/i);
  if (m) {
    const groups = 'ABCDEFGH';
    const idx = parseInt(m[1], 10) - 1;
    return groups[idx] ? `Group ${groups[idx]} (小组赛)` : raw;
  }
  if (/round of 16/i.test(raw)) return '1/8 决赛';
  if (/quarter/i.test(raw)) return '1/4 决赛';
  if (/semi/i.test(raw)) return '半决赛';
  if (/third/i.test(raw)) return '三四名决赛';
  if (/final/i.test(raw)) return '决赛';
  return raw;
}

/** 转换为北京时间 (UTC+8) 显示 */
export function formatMatchTime(dateStr: string): string {
  const d = new Date(dateStr);
  // 强制 UTC+8
  const beijing = new Date(d.getTime() + 8 * 3600 * 1000);
  const M = String(beijing.getUTCMonth() + 1).padStart(2, '0');
  const D = String(beijing.getUTCDate()).padStart(2, '0');
  const h = String(beijing.getUTCHours()).padStart(2, '0');
  const m = String(beijing.getUTCMinutes()).padStart(2, '0');
  return `${M}/${D} ${h}:${m}`;
}
