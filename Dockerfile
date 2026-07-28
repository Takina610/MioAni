# Playwright 官方镜像：已含 Chromium + 系统依赖（与 lock 中 1.62.0 对齐）
FROM mcr.microsoft.com/playwright:v1.62.0-jammy

WORKDIR /app

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    # 镜像内已有浏览器，跳过 npm 再下载
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
# tsx 在 devDependencies，运行 API 需要它；lock 偶发不同步时用 install 更稳
RUN npm install --include=dev --omit=optional --no-audit --no-fund

COPY server ./server
COPY tsconfig.json tsconfig.node.json ./

# 非 root 运行（Playwright 镜像默认 pwuser）
USER pwuser

EXPOSE 10000
# Render 会注入 PORT；本地 docker run 可用 -e PORT=8787
CMD ["npx", "tsx", "server/index.ts"]
