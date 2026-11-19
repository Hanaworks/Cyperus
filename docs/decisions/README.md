# 技术决策记录(ADR)

本目录保存**架构与技术的不可逆决策**。任何推翻既有架构的改动必须先写 ADR,获批后再实施。

---

## 索引

| 编号 | 标题 | 状态 | 决策时机 | 文件 |
|---|---|---|---|---|
| ADR-001 | Markdown Renderer 与桌面架构选型 | `Proposed` | T16 / 建议用于 M1，待负责人批准 | [ADR-001-renderer-and-host.md](ADR-001-renderer-and-host.md) |
| ADR-002 | Markdown 样式隔离方案 | `Proposed` | T16 / 建议用于 M1，待负责人批准 | [ADR-002-style-isolation.md](ADR-002-style-isolation.md) |
| ADR-003 | 性能阈值与大文件策略 | `Proposed` | T16 / 建议用于 M1，待负责人批准 | [ADR-003-performance-thresholds.md](ADR-003-performance-thresholds.md) |
| ADR-004 | 源码目录布局(`src/host` + `src/ui`) | `Proposed` | 立即 | `ADR-004-source-layout.md` |
| ADR-005 | 大文件 IPC 传输方案(`Response` vs base64) | `Pending` | T10 实测后 | 待写 |

---

## 状态定义

| 状态 | 含义 |
|---|---|
| `Proposed` | 已提出,等待负责人确认 |
| `Accepted` | 已确认,实施中/已实施 |
| `Rejected` | 已否决,保留记录 |
| `Superseded` | 被后续 ADR 取代(需注明被哪一条取代) |
| `Pending` | 尚未到决策时机,内容为空占位 |

---

## 何时必须写 ADR

1. 推翻已 `Accepted` 的架构决定。
2. 引入新的运行时依赖(尤其是会进入发布包的)。
3. 修改安全策略(CSP、capabilities、消毒白名单)。
4. 修改性能阈值(ADR-003 之后)。
5. 修改数据格式(设置文件 schema、会话文件 schema)。
6. 决定支持/不支持某个平台。

## 何时不需要写 ADR

- 内部实现细节重构(不改接口、不改行为)。
- 修复 bug。
- 增加不改变架构的测试。
- 依赖的小版本升级(但仍需在 CHANGELOG 记录)。

---

## 模板

新建 ADR 时复制以下结构:

```markdown
# ADR-NNN — <标题>

- **状态**:Proposed
- **日期**:YYYY-MM-DD
- **决策者**:<角色>
- **影响范围**:<模块/文件>

## 背景

<问题是什么,为什么现在要决策。列事实,不列偏好。>

## 候选方案

### 方案 1:<名称>

<描述 + 优点 + 缺点 + 实测数据(若有)>

### 方案 2:<名称>

<同上>

## 决策

<选择了哪个,一句话结论>

## 理由

<为什么这个方案优于其他。必须是可验证的理由。>

## 后果

### 必须遵守

<具体到文件路径、配置项、命令>

### 需要验证

<后续任务编号 + 验证方式>

### 回滚成本

<若需推翻,代价是什么>

## 相关文档

<链接>

## 参考

<外部来源:官方文档、源码、issue>
```

---

## M0 结束时的必写项

`docs/design/12-implementation-plan.md` 的 `T16` 要求完成:

- **ADR-001**:明确 Renderer / Parser / Host 与被弃方案理由，附同口径观测和功能缺口。本轮用户已跳过 T14；Qt 无有效性能样本，不作宿主资源排名，**不能只用一项微基准就全盘改写架构**。
- **ADR-002**:明确命名空间 / Shadow DOM / iframe 的选择，区分已测的主题计算样式、不重解析和 Mermaid，与 T31 搜索、T32 完整视觉回归等待验收项。
- **ADR-003**:量化分段、缓存、去抖等工程初值；从 `benchmarks/results.csv` 提取观测，明确 browser dev / native 的边界。沿用设计的原生性能目标须标为待标定，**不得把目标、未测量或单次 IPC 写成性能达标承诺**。

三份 ADR 均为 `Proposed`，建议用于 M1，待负责人批准后才转为 `Accepted`。最终原生 IPC / 七份样本、独立的早一轮事后 idle 及约 2 MiB 长代码观测已纳入；basic 首次图片测量竞态已修复并复验，AC-10 未达标与 M1 待测范围仍明确保留。状态变更不代表这些能力已验收通过。
