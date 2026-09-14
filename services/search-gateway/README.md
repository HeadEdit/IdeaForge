# IdeaForge 联网搜索服务

联网搜索服务提供 Speed/Balanced 两种研究模式、搜索批处理和语义排序/去重。
服务使用 SearXNG 获取网页结果，由浏览器中的回答模型生成最终回复。

## 本地开发

1. 在项目根目录将 `.env.example` 复制为 `.env`，填写搜索规划模型的地址、名称、Key。
2. 启动项目附带的 SearXNG：`docker compose -f docker-compose.searxng.yml up -d`。SearXNG 仅供后端访问。
3. 运行 `npm run search-gateway`，另一个终端运行 `npm run dev`。
4. AI 设置中将联网搜索提供商选择为“SearXNG”，搜索地址留空（默认 `/api/search`），
   选择快速或均衡。若设置了 SEARCH_GATEWAY_TOKEN，填写相同的访问令牌。
5. 打开聊天节点，启用联网搜索。最终回答仍使用 AI 设置中的模型。

也可在 AI 设置中将联网搜索提供商选择为 Tavily。
聊天记录和工作区继续存储在本地 IndexedDB。浏览器模型 Key 不发送到搜索后端。
问题及最多十条近期对话会发送到搜索服务及其规划模型，查询词会发送到 SearXNG。

## 配置与成本

SEARCH_MODEL 必须支持 OpenAI-compatible tool calling。后端 Key 由部署者提供。
Speed 最多 2 轮规划、1 批搜索，Balanced 最多 6 轮规划、6 批搜索；每批最多 3 个查询。
若以上流程没有取得来源，会额外尝试一次原始问题搜索。
语义排序需要单独的 Embedding 模型，配置 SEARCH_EMBEDDING_* 后启用。
未配置或调用失败时使用搜索引擎次序与 URL 去重，并返回降级提示。
规划失败回退到原始问题搜索；没有任何来源时失败，不伪装成联网回答。
Speed/Balanced 按上游设计使用搜索摘要，不保证已读取网页全文。

## 自托管

填写 `.env`，包括随机 SEARXNG_SECRET，然后在根目录执行：

```
docker compose -f docker-compose.search.yml up -d --build
```

访问 http://localhost:8088。三个服务为静态前端、Node 搜索网关和 SearXNG。
网关与 SearXNG 不对宿主机发布端口。默认前端只绑定本机。
公开部署时应通过 HTTPS 反向代理发布，设置 SEARCH_ALLOWED_ORIGINS 为前端的精确来源，
并设置访问令牌或在网关前配置用户鉴权、限流。共享令牌不是多用户计费系统。
整个部署会使用后端提供者的规划/Embedding 额度。
生产环境建议固定经过验证的 SearXNG 镜像摘要，升级时重新验证搜索结果。

纯静态站点仍可独立发布，但联网搜索需在设置中填写可访问的 HTTPS 网关端点，例如
`https://search.example.com/api/search`，并在网关允许该前端来源。
该后端是长连接 Node 服务，不能直接作为静态文件部署到 Vercel；Serverless 适配不在本版范围。

## API

`POST /api/search`：JSON `{query, mode: "speed" | "balanced", history?: [{role, content}]}`。
返回 `{queries, sources: [{id, title, url, content}], warnings, mode}`。
设置 `Accept: text/event-stream` 获取标准 SSE：planning、searching、sources（计数）、
result（完整结果）或 error。只传操作进度，不传模型私有推理。
`GET /api/search/health` 检查进程和模型配置是否存在，不执行收费调用，不能证明上游可用。
若配置访问令牌，两个接口都需要 `Authorization: Bearer ...`。

服务限制：每次请求 64 KiB，最多 4 个并发请求、180 秒总时限，上游 30 秒时限与
2 MiB 响应上限。断开连接会取消下游请求。外部请求不能指定模型地址、搜索地址或抓取 URL。

## 验证

根目录 `npm run test:search` 使用离线 fixture 验证检索和 HTTP/SSE 行为。
真实验收需另外使用自己的模型与 SearXNG，观察来源相关性、多轮问题和实际成本。
