# nInfer · Qwen 中文聊天

GitHub Pages：https://shaotuoxiong.github.io/ninfer-chat-web/

迁移自本机 nInfer 聊天页，支持中文问答、多轮对话、流式输出、图片上传、停止生成和复制回答。无需访客登录。
模型列表来自服务 `/v1/models`，不固定猜测 model ID。对话保存在当前页面内存，刷新后清空；服务地址保存在浏览器本地。

GitHub Pages 托管静态网页。Qwen3.8-27B 继续在本机 RTX 4090 容器中运行；电脑、容器、网关及公网隧道均需在线。
当前使用免费 Pinggy HTTPS 隧道，每次约 60 分钟有效，重新连接会换地址。网页地址保持不变，API 到期后会断开。
本地 Python 网关监听 `127.0.0.1:8081`，将聊天 API 转发至 `127.0.0.1:8080`，支持 GitHub Pages 跨域和 SSE 增量转发，不要求修改现有模型容器。
`config.json` 指定默认推理地址，访客可通过右上角“服务设置”更改。更新默认地址后，未自行改过地址的浏览器会自动采用新配置。

## 启动或刷新公网推理接口

```bash
cd /home/sim/models/ninfer-chat-web
sg docker -c 'docker start ninfer-4090'
python3 tools/public_endpoint.py start
# 确认接口就绪后，将新地址同步到 GitHub Pages：
python3 tools/public_endpoint.py start --publish
python3 tools/public_endpoint.py status
# 只停止网关和隧道，模型仍运行：
python3 tools/public_endpoint.py stop
```

日志：`gateway.log`、`public-tunnel.log`。使用 Python 标准库、系统 OpenSSH 和已登录的 gh；不安装或升级宿主环境。
国内无加速器可达性未验证，不能保证。

## 重新构建网页

沿用本机已有 `ninfer-4090:web-chat` Docker 镜像内的 Bun / Vite / React 依赖：

```bash
sg docker -c 'docker run --rm -v /home/sim/models/ninfer-chat-web:/site -w /web ninfer-4090:web-chat sh -c "cp -r /site/source /web/pages-src && cp /site/tools/pages.vite.config.ts /web/pages.vite.config.ts && bunx tsc -p /web/pages-src/tsconfig.json && bun test /web/pages-src/lib/chat-stream.test.ts && bunx vite build --config /web/pages.vite.config.ts"'
cp build/index.html index.html
cp -r build/assets .
```

发布源沿用 `main` 分支根目录；提交构建后的 `index.html`、`assets` 和 `config.json` 后由 GitHub Pages 发布。
网页沿用本地聊天样式；上游 Apache-2.0 许可见 LICENSE 与 NOTICE。

## 本次验证

Docker 内 TypeScript 检查通过；SSE 解析的中文字节边界与服务错误测试共 2 项通过。
公网跨域预检返回 204，服务发现真实模型 ID `qwen3.8-27b`，SSE 回答分段到达。
免费隧道使用 `x:passpreflight` 透传浏览器预检，前端发送 `X-Pinggy-No-Screen`，避免提示页拦截 API。
