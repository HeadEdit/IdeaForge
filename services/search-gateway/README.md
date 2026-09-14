# IdeaForge 联网搜索服务

联网搜索支持两种提供商：**SearXNG**（本服务）与 **Tavily**。在 AI 设置的「联网搜索提供商」中切换，并在聊天节点中启用联网搜索。

## SearXNG

### 本地开发

1. 在项目根目录将 `.env.example` 复制为 `.env`，填写搜索规划模型的地址、名称、Key。
2. 启动 SearXNG：`docker compose -f docker-compose.searxng.yml up -d`。
3. 运行 `npm run search-gateway`，另一个终端运行 `npm run dev`。
4. AI 设置中将联网搜索提供商选择为「SearXNG」，搜索地址留空（默认 `/api/search`），并选择快速或均衡模式。若设置了 `SEARCH_GATEWAY_TOKEN`，填写相同的访问令牌。

可选：配置 `SEARCH_EMBEDDING_*` 启用 Embedding 排序与去重。

### 自托管

填写 `.env`（含随机 `SEARXNG_SECRET`），然后在根目录执行：

```bash
docker compose -f docker-compose.search.yml up -d --build
```

访问 http://localhost:8088。

纯静态前端部署时，在 AI 设置中填写可访问的网关地址，例如 `https://search.example.com/api/search`。

### API

- `POST /api/search`：请求体 `{query, mode: "speed" | "balanced", history?: [{role, content}]}`。设置 `Accept: text/event-stream` 可使用 SSE。
- `GET /api/search/health`：健康检查。

若配置了访问令牌，上述接口需带 `Authorization: Bearer ...`。

## Tavily

1. 在 AI 设置中填写 Tavily API Key。
2. 将「联网搜索提供商」选择为 Tavily。

无需启动本搜索服务。
