# 全球骑行配件 B2B 线索采集工具 v7.1

这是一个无外部依赖的 Node.js 单文件网页工具，适合部署到 Render。

## 重点修复
- 搜索词不再把产品标签全部拼进去，避免公开搜索返回 0。
- 国家/城市是单选筛选。
- 产品方向标签只用于评分，不强行污染搜索词。
- 增加本地语言搜索词，例如 Sweden 会自动使用 cykelbutik / cykelhandlare 等。
- 增加搜索诊断。
- 保留手动官网列表模式。

## Render
Start Command:

```bash
npm start
```

不需要环境变量。
