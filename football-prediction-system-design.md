# 足球预测系统技术设计文档

## 1. 概述

这是一个面向世界杯足球比赛的工业级预测系统技术设计文档。系统的核心结构为：

- Data Layer
- Feature Layer
- Lambda Model
- Simulation Layer

系统目标不仅是还原“Antigravity AI Cognitive Engine”的交互效果，更重要的是构建一个可持续演进、可迭代优化的预测平台。

---

## 2. 核心设计原则

### 2.1 预测器与模拟器的分工

- `λ`（进球期望值）是预测器
- `Monte Carlo` 是模拟器

真正决定预测质量的是 `λ` 的建模能力，而 Monte Carlo 只是把 `λ` 转换成概率分布与比分分布。

### 2.2 分层解耦

- `feature.ts`：生成特征
- `simulation.ts`：执行 Monte Carlo
- `predict.ts` / `index.ts`：API 路由
- `seed.ts`：数据初始化
- 前端组件：展示与交互

### 2.3 赔率作为市场因子

- 赔率是“市场信息”，而不是主导特征
- 权重控制在 `10%-20%`
- 防止模型学会复制博彩公司盘口

### 2.4 神经网络暂缓

- 数据量小的情况下，首选树模型
- 例如：`LightGBM` / `XGBoost` / `CatBoost`
- 神经网络应留到数据积累后再考虑

---

## 3. 最终系统架构

```
backend/
  prisma/
    schema.prisma
    seed.ts
  src/
    index.ts
    feature.ts
    simulation.ts
    routes/
      matches.ts
      predict.ts
frontend/
  src/
    App.vue
    main.ts
    components/
      LeftPanel.vue
      RightPanel.vue
      MatchCard.vue
  index.html
  vite.config.ts
```

---

## 4. 数据模型

### 4.1 必要数据表

- `Team`
- `Match`
- `TeamStats`
- `Player`
- `PlayerStats`
- `Odds`
- `OddsHistory`
- `PredictionHistory`
- `FeatureSnapshot`

### 4.2 各表作用

#### Team

球队基础信息、ELO、国旗、名称等。

#### Match

比赛信息、时间、阶段、主客队、状态。

#### TeamStats

xG、xGA、form、近期统计特征。

#### Player / PlayerStats

球员价值、重要性、伤停状态、贡献度。

#### Odds / OddsHistory

- `Odds`：当前盘口
- `OddsHistory`：赔率时序曲线

#### PredictionHistory

记录预测值、实际结果、误差指标、版本标签。

#### FeatureSnapshot

存储预测时的特征向量快照，便于回测与训练。

---

## 5. 模块划分

### 5.1 Data Layer

负责数据建模、持久化、读取与聚合。包括：

- Prisma/SQLite（开发）
- PostgreSQL（生产）
- 数据同步脚本
- API 数据采集

### 5.2 Feature Layer

负责将原始数据转化为预测特征，包括：

- `EloDiff`
- `xGDiff`
- `xGADiff`
- `FormDiff`
- `InjuryDiff`
- `HomeAdvantage`
- `OddsDelta`
- `OddsImplied`

并将结果写入 `FeatureSnapshot`。

### 5.3 Lambda Model

负责计算 `homeLambda` 与 `awayLambda`。

可支持不同模型：

- 线性 Lambda
- LightGBM Lambda
- XGBoost Lambda
- CatBoost Lambda

### 5.4 Simulation Layer

负责基于 λ 生成比分概率，执行：

- Poisson
- Dixon-Coles
- Monte Carlo

输出：

- 胜平负概率
- Top 3 精确比分
- Over/Under
- Spread
- Confidence

### 5.5 Evaluation Layer

负责对预测结果进行评估和回测，包括：

- Brier Score
- LogLoss
- Calibration Curve
- Hit Rate
- ROI

它是预测平台从“会预测”变成“会变强”的关键系统。

---

## 6. 特征与 λ 计算

### 6.1 关键特征

- `eloDiff`
- `xgDiff`
- `xgADiff`
- `formDiff`
- `injuryDiff`
- `homeAdvantage`
- `oddsDelta`
- `oddsImplied`

### 6.2 injuryPenalty 设计

按球员价值加权计算：

```
injuryPenalty = Σ(playerImpactScore × unavailable)
```

而不是简单的人数统计。

### 6.3 赔率处理

- 使用赔率变化值 `oddsDelta`
- 用赔率隐含概率做软约束
- 权重控制在 `10%~20%`

### 6.4 λ 计算思路

建议通过双输出模型学习：

输入特征：

- `EloDiff`
- `xGDiff`
- `FormDiff`
- `InjuryDiff`
- `HomeAdvantage`
- `OddsImplied`

输出：

- `homeLambda`
- `awayLambda`

这是 Phase 3 以后升级的重要方向。

---

## 7. 回测与版本管理

### 7.1 Feature Store

新增 `FeatureSnapshot`，用于：

- 预测时只计算一次特征
- 回测复用同一特征快照
- 模型训练与结果分析

### 7.2 Odds 时序表

新增 `OddsHistory` 表，记录赔率随时间的变化。

例如：

```
09:00 巴西 1.70
11:00 巴西 1.65
14:00 巴西 1.58
17:00 巴西 1.52
```

这条曲线本身就是重要特征。

### 7.3 Feature / Model Version

在 `PredictionHistory` 中增加：

- `featureVersion`
- `modelVersion`
- `simulationVersion`

示例：

- `feature_v1.2`
- `lambda_v1.5`
- `simulation_v1.0`

用于历史对比与回测。

### 7.4 Evaluation Engine

新增 `Evaluation Engine` 模块，负责对预测结果进行质量评估和回测。

指标包括：

- `Brier Score`
- `LogLoss`
- `Calibration Curve`
- `Hit Rate`
- `ROI`

这个模块是系统持续改进的闭环基础，确保平台不仅能预测，还能不断变强。

---

## 8. 阶段化开发计划

### Phase 1：MVP（第 1 周）

目标：可运行、可展示、可联调。

完成内容：

- `Team`, `Match`, `Odds`, `PredictionHistory`
- `feature.ts` 简单 λ 计算
- `simulation.ts` Poisson + Monte Carlo
- Vue 左右结构看板
- 预测 API 与前端联调

### Phase 2：增强版（第 2 周）

目标：显著提升预测能力。

完成内容：

- 扩展 `TeamStats`, `Player`, `PlayerStats`
- 加入 `OddsHistory`
- 计算 `injuryPenalty`
- 记录 `PredictionHistory`
- 增加缓存防御与组件隔离
- 引入 `Dixon-Coles` 修正
- 改善低比分相关性

### Phase 3：专业版（第 4 周）

目标：接近商业级预测系统。

完成内容：

- PostgreSQL 生产环境迁移
- 接入真实数据源
- 用 `LightGBM / XGBoost / CatBoost` 学习 λ
- 自动回测与校准

### Phase 4：模型工厂与自动化回测

目标：构建可配置、可迭代的预测平台。

完成内容：

- `Model Registry`
- 自动回测系统
- 校准层（Platt Scaling / Isotonic Regression）

---

## 9. 关键开发任务清单

### Task 1

完成 Prisma schema 与 seed 数据。

### Task 2

实现 `feature.ts`：计算特征并生成 `FeatureSnapshot`。

### Task 3

实现 `simulation.ts`：Poisson + Monte Carlo。

### Task 4

完成前端界面：

- 左侧 AI 看板
- 右侧比赛列表
- Activate AI Predict

### Task 5

增加 `PredictionHistory` 与回测指标。

### Task 6

引入 `OddsHistory`, `PlayerStats`, `injuryPenalty`。

### Task 7

阶段性导入树模型训练 λ。

---

## 10. 评价与结论

这份方案已经超出了普通“足球预测项目”的范围，具备：

- 专业系统架构
- 完整数据层设计
- 预测层设计
- 回测层设计
- 未来 AI 训练入口

剩下的不是“怎么设计”，而是“把设计变成代码”。

按照此方案执行，完成 Phase 2 后即可实现一个与视频效果高度一致的预测平台；完成 Phase 3 后，则能真正向专业机构预测系统靠拢。
