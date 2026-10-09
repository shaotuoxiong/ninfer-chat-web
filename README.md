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
sg docker -c 'docker run --rm -v /home/sim/models/ninfer-chat-web:/site -w /web ninfer-4090:web-chat sh -c "cp -r /site/source /web/pages-src && cp /site/tools/pages.vite.config.ts /web/pages.vite.config.ts && bunx tsc -p /web/pages-src/tsconfig.json && bun test /web/pages-src/lib/chat-stream.test.ts && bunx vite build --config /web/pages.vite.config.ts"'
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
