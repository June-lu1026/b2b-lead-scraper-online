# b2b-lead-scraper-online v4 筛选版

免费在线版：面向骑行配件外贸，优先寻找自行车店、骑行店、配件经销商、批发商、分销商官网，并从公开页面提取邮箱和电话。

## v4 新增

- 增加结果筛选区
- 可按线索类型筛选：门店、经销商、分销商、批发商
- 可设置最低总分、最低匹配度
- 可只看有邮箱 / 有电话的线索
- 可开启“地区相关 / 德国站优先”
- 可隐藏新闻、测评、论坛、平台页
- 可自定义排除关键词
- 下载 CSV 时默认下载筛选后的结果

## 特点

- 不需要 Google Places API
- 不需要 Gemini API
- 支持 Render 在线部署
- 支持关键词 + 地区公开搜索
- 支持手动粘贴官网列表，一行一个
- 增加骑行行业相关性过滤，减少 Microsoft、搜索引擎帮助页、品牌官网、新闻/测评站、无关平台结果

## Render 配置

- Runtime: Node
- Build Command: 留空或 `npm install`
- Start Command: `npm start`
- Plan: Free

## 推荐关键词

德国本地门店：

- Fahrradladen
- Fahrradgeschäft
- Radladen
- bike dealer
- bicycle shop

经销商 / 分销商：

- Fahrrad Händler
- bicycle accessories distributor
- bike parts wholesaler
- cycling accessories distributor
- bicycle parts distributor

## 使用建议

免费公开搜索源不如 Google Places 稳定。如果自动搜索不准，建议从行业协会、展会名录、Google 搜索结果、品牌经销商页面复制官网，粘贴到“官网列表”区域，工具会直接分析这些网站。
