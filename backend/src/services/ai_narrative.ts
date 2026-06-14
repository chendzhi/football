/**
 * AI 战术评述 — 将 λ + 胜率 + 比分 → DeepSeek 生成中文战术裁决
 */

interface NarrativeInput {
  homeName: string; awayName: string;
  homeLambda: number; awayLambda: number;
  homeProb: number; drawProb: number; awayProb: number;
  topScores: Array<{ score: string; prob: string }>;
}

export async function generateAINarrative(input: NarrativeInput): Promise<string> {
  const prompt = `你是资深足球量化精算师。基于以下数据写一段80字以内战术裁决报告，不要开场白，直接说核心原因。
${input.homeName} vs ${input.awayName}
进球期望λ: 主${input.homeLambda} 客${input.awayLambda}
胜率: 主${input.homeProb}% 平${input.drawProb}% 客${input.awayProb}%
前三比分: ${input.topScores.map(s => s.score + '(' + s.prob + '%)').join(' ')}`;

  try {
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY || ''}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 200,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) throw new Error('API error');
    const data = await resp.json() as any;
    return data.choices?.[0]?.message?.content || '认知引擎数据溢出，无法生成文本特征。';
  } catch {
    // Fallback: 基于 λ 差值生成规则文本
    return buildFallbackNarrative(input);
  }
}

/** 无 API Key 时的规则回退 */
function buildFallbackNarrative(input: NarrativeInput): string {
  const gap = input.homeLambda - input.awayLambda;
  if (gap > 1.0) {
    return `主队λ值(${input.homeLambda})对客队(${input.awayLambda})形成碾压级压制，蒙特卡洛矩阵中主胜路径占据绝对统治。预期控球率与射门转化率双双领先，客队防线将承受持续高压。`;
  } else if (gap > 0.3) {
    return `主队λ(${input.homeLambda})略优于客队(${input.awayLambda})，但优势未达统治级。平局概率(${input.drawProb}%)表明中场绞杀将是主旋律，胜负取决于禁区内的瞬间决策质量。`;
  } else if (gap > -0.3) {
    return `λ值近乎均衡(主${input.homeLambda} vs 客${input.awayLambda})，这是典型的博弈盘口。进球分布高度离散，双方均缺乏绝对统治力，比赛走向对初始战术布置极度敏感。`;
  } else {
    return `客队λ(${input.awayLambda})反超主队(${input.homeLambda})，蒙特卡洛矩阵中客胜路径权重显著升高。主队防线存在结构性漏洞，客队反击与定位球将成为决定性变量。`;
  }
}
