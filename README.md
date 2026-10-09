# nInfer · Qwen 中文聊天

网页：https://shaotuoxiong.github.io/ninfer-chat-web/

固定推理入口：https://letdown-riverboat-flatware.ngrok-free.dev

网页支持多轮对话、流式输出、图片上传、停止生成和复制回答，无需访客登录。
Qwen3.8-27B 仍运行在本机 RTX 4090，模型 ID 来自 `/v1/models`。
对话自动保存在本浏览器 IndexedDB，包括文字、模型回答和已发送图片；刷新、关闭重开后恢复最近对话。历史列表支持切换、新建和删除对话，恢复后继续携带上下文请求模型。服务地址保存在浏览器本地。

## 固定公网入口

已从 60 分钟 Pinggy 临时隧道切换到 ngrok 账户分配的固定开发域名。
ngrok 官方免费端点没有会话到期限制，但每月有 1 GB 出站流量及 20,000 次 HTTP 请求等额度。
官方说明：https://ngrok.com/docs/pricing-limits/free-plan-limits
电脑、网络、模型和公网代理均需在线；固定域名并不代表关机后仍可推理。
国内不使用加速器的可达性未验证，不能保证。

实际安装的代理版本：ngrok 3.39.8、网关容器 Python 3.12.15。
Docker 镜像固定到 digest，见 `compose.public.yml`；未升级宿主 CUDA、Python、PyTorch 或 Conda。
`ninfer-chat-gateway` 监听本机 `127.0.0.1:8081`，转发聊天 API 到 `127.0.0.1:8080`。
`ninfer-chat-ngrok` 使用固定 HTTPS 域名转发到网关；两个容器均设为 `unless-stopped` 自动恢复。
原模型容器启动方式保留，系统重启后需确认 `ninfer-4090` 已启动。

```bash
cd /home/sim/models/ninfer-chat-web
# 启动已有模型及固定公网代理：
python3 tools/public_endpoint.py start
# 查看固定地址和代理状态：
python3 tools/public_endpoint.py status
# 重启公网代理：
python3 tools/public_endpoint.py restart
# 只关闭公网代理，本机模型继续运行：
python3 tools/public_endpoint.py stop
# 需要释放模型显存时：
sg docker -c 'docker stop ninfer-4090'
```

默认地址保存在 `config.json`，不需要每隔 60 分钟修改或重新发布。
前端通过 `ngrok-skip-browser-warning` 请求头访问 API；网关允许 GitHub Pages 跨域，且逐段转发 SSE。
右上角“服务设置”支持切换推理地址。未手动更改过服务地址的浏览器会自动采用更新后的默认配置。

## 本机认证凭据

ngrok 凭据仅保存在 `.private/ngrok.env`，目录权限 700、文件权限 600。
`.private/` 已被 Git 忽略，凭据不会写入前端、构建文件、Compose 或公共仓库。
只在本机更换该文件中的 `NGROK_AUTHTOKEN`，重新创建 ngrok 容器后生效：

```bash
sg docker -c 'docker compose -f compose.public.yml up -d --force-recreate ngrok'
```

不要上传凭据文件，访客不需要知道该凭据。

## 重新构建网页

沿用已有 `ninfer-4090:web-chat` Docker 镜像内的 Bun / Vite / React：

```bash
sg docker -c 'docker run --rm -v /home/sim/models/ninfer-chat-web:/site -w /web ninfer-4090:web-chat sh -c "rm -rf /web/pages-src && cp -r /site/source /web/pages-src && cp /site/tools/pages.vite.config.ts /web/pages.vite.config.ts && bunx tsc -p /web/pages-src/tsconfig.json && bun test /web/pages-src/lib/chat-stream.test.ts /web/pages-src/components/MessageText.test.tsx && bunx vite build --config /web/pages.vite.config.ts"'
cp build/index.html index.html
cp -r build/assets .
```

Pages 发布源为 `main` 分支根目录。上游 Apache-2.0 许可见 LICENSE 与 NOTICE。

## 2026-10-09 验证

TypeScript 检查通过；SSE 中文字节边界与服务错误测试共 2 项通过。
固定 HTTPS 入口模型发现返回 200，真实模型 ID `qwen3.8-27b`。
GitHub Pages 跨域预检返回 204；中文 SSE 实测 60 个内容事件，首段 0.994 秒、末段 2.537 秒，包含公网延迟。

真实浏览器多轮记忆、图片左右红蓝识别、增量显示与停止生成均通过。重建代理后固定域名保持不变。首次浏览器连接曾被网络关闭，刷新后功能测试通过。

## 对话记忆与 4 并发（2026-10-09）

模型启动参数已改为 `--max-concurrency 4`，保留共享 32K KV、视觉开启、MTP 关闭。
本机启动脚本 `/home/sim/projects/ninfer-4090/run-local.sh` 默认即为 4 并发，模型缓存卷保留。
长对话会共享有限的 KV 容量，超过容量时仍可能等待；该配置不是每人独占 32K。

历史保存不需要访客登录，各浏览器独立保存，不会读取其他访客的对话。
新建对话会保留旧对话，删除此对话会持久移除记录；关闭页面前可能保存正在生成的部分回答，不会自动继续生成。
历史属于当前网站、当前浏览器；无痕模式、清除网站数据或换设备不会保留这些记录。
更新之前已因刷新丢失的对话无法从新功能恢复。

真实浏览器已验证：刷新恢复文字、刷新恢复图片、重进页面恢复当前对话、历史切换、恢复后继续问答、删除持久生效。
本机 `/chat` 同步提供该功能，但与 GitHub 网站因不同来源而各自保存历史。

四请求实测结果见 `concurrency-results.json` 与 `public-concurrency-results.json`：
本机四路生成重叠 10.47 秒；浏览器公网四路重叠 8.92 秒，各路约 47 tokens/s。
工作负载为 41–44 token 的短提示及约 500 token 的数字输出，部分请求使用缓存；不代表长上下文或多图性能。
200 ms 显存采样峰值为整卡 20,712 MiB（20.23 GiB），包括桌面等其他进程；测试后模型容器系统内存约 2.12 GiB。
服务日志确认 `running=4`、decode batch=4，未发现 CUDA OOM。
首次 Python 公网多连接测试有连接中断，本机及浏览器公网并发测试均通过；公网网络仍可能影响首段延迟。

## 对话侧栏与页面更新（2026-10-09）

页面采用左侧历史、右侧对话的布局；侧栏按今天、昨天、过去 7 天和更早分组。
搜索框可搜索标题和消息内容。对话右侧“⋯”提供重命名与删除，删除前需确认；自定义名称不会被后续消息覆盖。
手机默认收起侧栏，点击左上角图标展开；桌面也可收起。回答支持粗体、行内代码、标题及代码块。
继续使用原有 IndexedDB 数据库，已保存的对话和图片保留。历史仍只保存在当前浏览器中。

真实浏览器测试通过：历史恢复后继续问答、名称刷新保持、搜索、图片恢复、手机抽屉、删除其他对话时保留当前对话、代码排版、流式显示及停止生成。
模型仍为 4 并发，本次页面更新不修改推理参数。

## Markdown、主题与回答风格（2026-10-09）

默认浅色，顶部月亮/太阳按钮切换深色或浅色；主题保存在当前浏览器。
使用 react-markdown 10.1.0、remark-gfm 4.0.1、rehype-highlight 7.0.2，依赖与版本锁记录在 package.json / bun.lock。
支持标题、嵌套列表、引用、表格、任务列表、链接和代码高亮；代码块可单独复制，宽表格和代码块在手机上内部横向滚动。
仅将普通 `<br>` 标签转换为安全换行，其他 HTML 不解析；代码中的 `<br>` 原样显示。
参考库官方说明：[react-markdown](https://github.com/remarkjs/react-markdown)、[remark-gfm](https://github.com/remarkjs/remark-gfm)、[rehype-highlight](https://github.com/rehypejs/rehype-highlight)。

每次聊天请求在历史消息前加入 source/lib/chat-prompt.ts 中的系统提示，默认简洁中文、减少无用铺垫，允许用户指定其他语言、格式或详细程度。
该提示不写入聊天历史，不提供联网检索，也不保证模型绝不产生错误；访客仍应核实重要信息。
历史数据库保持不变，旧回答重新按完整 Markdown 排版，原有文字和图片保留。模型保持 4 并发，未更改权重。

验证：TypeScript 通过；Markdown 标题/嵌套列表/表格换行与安全渲染、SSE 共 4 项测试通过。
真实浏览器确认主题刷新保持、真实请求含系统提示、模型表格与 Python 代码高亮、代码复制、格式化历史恢复、手机布局。

## 数学公式显示（2026-10-09）

接入 remark-math 6.0.0、rehype-katex 7.0.1、KaTeX 0.16.47，版本与依赖已锁定。
支持 `$...$` 行内公式和 `$$...$$` 独立公式，包括 π、分数、积分等；独立公式建议用单独的两行 `$$` 包围。
KaTeX 样式与字体打包到本站 assets，不依赖外部字体 CDN；手机长公式在回答内部横向滚动。
原始历史内容保持不变，刷新后旧回答中的公式重新渲染。代码中的公式源码保留原样。
无效或尚未完整生成的公式会回退显示源码，不能执行不受信任的 TeX 链接或 HTML。
TypeScript 与公式/Markdown/SSE 合计 6 项测试通过，真实模型公式、字体加载、历史恢复与手机显示验证通过。
官方库说明：[remark-math](https://github.com/remarkjs/remark-math/tree/main/packages/remark-math)、[rehype-katex](https://github.com/remarkjs/remark-math/tree/main/packages/rehype-katex)。

## 自动联网回答：free-search-mcp（2026-10-09）

已安装视频推荐的 free-search-mcp 0.13.1，源仓库 https://github.com/sweetcornna/free-search-mcp，commit `e4bf2342d68cf3e4aa05801f363c88695f944dbf`。
使用项目官方 Dockerfile、uv.lock 和 Chromium，容器 Python 3.12.15、MCP SDK 2.2.0、Playwright Chromium 145.0.7632.6。
基础 Python 镜像 digest `05cda9777409a9c3ffddd94a4c476b79f0769a0b4857f0c7ed9226b6800b0d6f`；构建 uv 镜像 digest `3af4716e991d6956a41e573eab705d0ee08500cd829ed30293eb8472f372c65a`。
不需要注册或 API Key，不修改宿主 CUDA、Conda、PyTorch 或 Codex 配置。

网页提问自动调用 `/v1/research/chat/completions`，先由本机 Qwen 根据文字问题及上一轮问题判断是否需要联网，再选择检索深度，没有联网开关。常识、稳定知识、数学、编程基础、写作、翻译、闲聊、模型身份和对话总结直接回答；明确的身份/问候等问题走快速规则。显式要求联网时仍搜索。简单查询目标 3 篇，最新消息和产品对比目标 6 篇，深入研究/文献综述/研究报告最多 16 篇。实际篇数可能因结果不足或网页无法读取而减少。
使用 MCP `search` 和 `fetch` 组合，突破单次 `research` 的 8 篇限制；去重后按官方/学术/政府域名线索优先排序，6/16 篇任务补充官方资料搜索，不能保证每个问题都有足够官方资料。仅成功读取正文的页面计入来源，失败时尝试备用链接。最新消息强制刷新；其他问题缓存最多 1 小时。
本机 `/chat` 通过 127.0.0.1:8081 网关访问此流程；GitHub 页面沿用固定 ngrok 域名。原始模型 API 仍供直接推理使用。
“已读取的资料”可展开查看真实来源；来源与回答一同保存至浏览器。搜索摘要不算已读取的正文。搜索失败或正文无法读取时明确报错，不伪造联网成功。
正文片段总预算：简单问题最多 18,000 字符，6/16 篇最多 24,000 字符，随历史长度缩减，各篇均分预算且单篇最多 6,000 字符。页面显示实际成功读取数；传入的是正文片段，不声称完整阅读长文。本机模型判断或快速规则可能误判，可在问题中明确写“联网搜索”或“深入研究”。模型可能存在引用或理解错误，重要结论仍需核实原文。
单次 MCP 调用最长等待 150 秒，网页正文在所有请求间最多 8 路并行，普通与官方来源搜索同时执行；多篇任务会更久。此前 3 篇流程首次联网实测约 24 秒，缓存和网络状况会影响耗时，页面速度中的首 Token 是模型推理计时，不包含搜索时间。

搜索服务只监听 `127.0.0.1:8090/mcp`，未开放公网。网关仅转发规定的模型及聊天接口，不公开 MCP 通用工具。
持久缓存卷 `ninfer-chat-public_ninfer-search-cache`；缓存搜索及正文最多沿用 1 小时，来源读取时间一并交给模型。
保留上游 SSRF 防护，使用默认 Fake-IP 自动检测，未开启 private-host 或本地文件读取。网页资料只作为事实材料，不作为可执行指令。

重新构建搜索服务：

```bash
git clone https://github.com/sweetcornna/free-search-mcp.git .search-mcp-src
git -C .search-mcp-src checkout e4bf2342d68cf3e4aa05801f363c88695f944dbf
sg docker -c 'docker build --network host --tag ninfer-free-search:0.13.1 .search-mcp-src'
sg docker -c 'docker compose -f compose.public.yml up -d'
```

单独停止/启动搜索服务：

```bash
sg docker -c 'docker compose -f compose.public.yml stop search-mcp'
sg docker -c 'docker compose -f compose.public.yml up -d search-mcp'
```

验证：MCP 真实搜索返回 Ubuntu 生命周期、官方桌面下载及发行目录，并成功读取 3 篇正文；中文 Qwen 问答返回来源。
日志确认 Bing 不相关结果被识别并丢弃。网关判断分流、官方排序、备用读取、验证码过滤、正文预算、失败处理与图片历史保留的 9 项测试通过；前端 Markdown/公式/SSE 共 6 项通过。
首次网关重建后测试触发启动时连接拒绝，服务就绪后重试通过。免费引擎仍可能限流或验证，不保证每次都能检索成功。

本次采样：搜索容器约 259.5 MiB 系统内存，网关约 22.25 MiB；均未分配 GPU。浏览器缓存命中问答约 8 秒，不代表所有查询速度。
图片仍只交给本机模型；搜索引擎接收用户的文字问题，不上传图片或额外提取图片内容用于检索。

2026-10-09 分流更新实测：模型身份不检索，牛顿第一定律、冒泡排序、水结冰均由本机判断为直接回答（约 0.47–0.70 秒分类）；最新 Ubuntu 查询读取 6 篇并返回模型回答。深入研究请求在剔除验证码页面后实际读取 9 篇并完成 Qwen 推理（约 9 秒缓存命中），配置上限 16 篇；不是保证每次读满。预览及本机浏览器的直接回答状态、刷新恢复、移动端检查通过。


## 2026-10-09 读取加速与断线恢复

- 普通搜索和官方来源搜索并行，搜索阶段最多等待 20 秒；网页正文采用共享 8 路线程池，按完成顺序处理，慢页面不阻塞已完成结果。简单/对比读取阶段预算 14 秒，复杂研究预算 22 秒。MCP 请求分别限制搜索 18 秒、单页 12 秒，搜索服务 HTTP 超时 8 秒、抓取超时 10 秒；超时或验证码页面不计入有效来源。3/6/16 篇上限继续有效，预算内只读到部分资料时如实显示。
- 网关后台任务与访客连接分离，最多同时运行 4 个任务；断线后继续生成，完成事件、正文、来源和错误保存在 SQLite 持久卷 `ninfer-chat-public_ninfer-generation-cache`。输入只保存指纹；浏览器通过不可猜测的 UUID 找回单个任务，没有公开任务列表。
- 同一 `request_id` 重试不会重复推理；前端携带 `after` 序号补收并去重。每 5 秒发送 SSE 保活；断线自动重试最多 20 次，间隔递增至 5 秒。较长断网后可刷新页面恢复。
- 浏览器 IndexedDB 保存待完成任务。页面刷新/关闭后重新打开相同对话可恢复后台答案；显式点击停止才请求取消。完成缓存约保留 24 小时，下一次新任务清理过期记录。历史回答继续保存在浏览器。
- 网关重启保留此前输出，但仍在生成的模型任务无法原地续跑，会明确报错；主机/模型宕机、缓存过期或清除浏览器数据不属于短暂网络断线恢复范围。此机制不能阻止 ngrok 链路掉线。

实际验证：12 项 Python 检索/后台缓存测试、8 项前端测试和 TypeScript/Vite 构建通过。真实接口中途断开后重连，补收与完整缓存逐字一致；真实浏览器自动重连、刷新途中恢复、完成历史恢复、明确停止均通过。
新鲜“最新 Ubuntu 桌面版本”查询实测读取 6 篇，包含检索的首个正文 Token 约 20.00 秒，180 Token 上限的完整请求约 23.91 秒；这是一次样本，不保证每个网站和问题同样快。页面显示的“模型首 Token”仍只计模型推理阶段。
