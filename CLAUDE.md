# PtIDLE 开发规范

## 核心规则

1. **写任何代码前必须完整阅读** `memory-bank/architecture.md`（包含完整数据库结构）
2. **写任何代码前必须完整阅读** `memory-bank/specs.md`
3. **每完成一个重大功能或里程碑后，必须更新** `memory-bank/architecture.md`
4. **没有用户的测试和审阅之前，不允许提交到远端仓库**

## 工作流程（单步循环）

```
┌─────────────────────────────────────────────────────────┐
│  1. 阅读 memory-bank 所有文档                            │
│  2. 消除歧义（向人类提问澄清）                           │
│  3. 使用 Ask/Plan 模式确认当前步骤的方案               │
│  4. 执行代码生成                                         │
│  5. 人类运行测试验证                                     │
│  6. 测试通过后，AI 更新 progress.md 和 architecture.md │
│  7. Git 提交代码                                         │
│  8. 记录 Prompt 日志（追加到 history.md）              │
│  9. 清理上下文，进入下一步循环                           │
└─────────────────────────────────────────────────────────┘
```

## 工作流日志记录协议

每个任务收尾时，必须在 `history.md` 末尾追加以下格式的日志：

```markdown
## {{YYYY-MM-DD}} - 任务：{{自动推断的当前任务简明名称}}

### Prompt
{{高度提炼用户发送的核心需求或指令意图，剔除冗余沟通词汇}}

### 思考
{{简述对该阶段任务的架构理解、核心逻辑或关键设计决策}}

### 意外
{{记录执行过程中发生的未覆盖报错、需求变更、踩坑点，或过度设计。若完全顺利，则填"无"}}
```

## 文档位置

- `memory-bank/specs.md` - 产品需求文档
- `memory-bank/tech-stack.md` - 技术栈文档
- `memory-bank/implementation-plan.md` - 实施计划
- `memory-bank/architecture.md` - 架构文档（需持续更新）
- `memory-bank/progress.md` - 执行进度记录
- `history.md` - 工作流日志
