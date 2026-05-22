# b2b-lead-scraper-online v3

免费在线版：面向骑行配件外贸，优先寻找自行车店、骑行店、配件经销商、批发商、分销商官网，并从公开页面提取邮箱和电话。

## 特点

- 不需要 Google Places API
- 不需要 Gemini API
- 支持 Render 在线部署
- 支持关键词 + 地区公开搜索
- 支持手动粘贴官网列表，一行一个
- 增加骑行行业相关性过滤，减少 Microsoft、搜索引擎帮助页、品牌官网、无关平台结果

## Render 配置

- Runtime: Node
- Build Command: 留空或 `npm install`
- Start Command: `npm start`
- Plan: Free

## 推荐关键词

- bike dealer
- bicycle shop
- cycling store
- bicycle accessories distributor
- bike parts wholesaler
- Fahrradladen
- Radladen

## 使用建议

免费公开搜索源不如 Google Places 稳定。如果自动搜索不准，建议从行业协会、展会名录、Google 搜索结果、品牌经销商页面复制官网，粘贴到“官网列表”区域，工具会直接分析这些网站。
