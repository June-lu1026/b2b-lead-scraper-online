# 全球骑行配件 B2B 线索采集工具 v6.2

无需 Google Places API。无需额外 npm 包。部署到 Render 后可在线使用。

## 功能

- 全球国家/城市市场筛选
- 客户类型筛选：店、经销商、分销商、批发商、进口商、维修店
- 产品方向筛选：power meter、crankset、bike parts、cycling accessories 等
- 必须包含关键词、排除关键词/域名
- 只看有邮箱、只看有电话
- 最低总分、最低匹配度
- 手动粘贴官网列表模式
- 开始按钮修复：按钮点击、表单提交、回车均可触发
- 超时保护和停止按钮
- CSV 导出

## Render 部署

Build Command:

```bash
npm install
```

Start Command:

```bash
npm start
```

## 使用建议

免费版依赖公开网页搜索，搜索源可能限制服务器请求。若自动搜索不准，建议从展会名录、协会目录、黄页、Google 手动结果中复制官网列表，粘贴到顶部官网列表框，一行一个，让工具直接提取邮箱。
