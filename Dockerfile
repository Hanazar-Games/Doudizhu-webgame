# Doudizhu WebGame - Dockerfile
# 构建生产镜像: docker build -t doudizhu .
# 运行: docker run -p 3001:3001 doudizhu

FROM node:20-alpine AS builder

WORKDIR /app

# 安装依赖
COPY package.json package-lock.json ./
RUN npm ci

# 复制源码并构建
COPY . .
RUN npm run build

# 生产镜像
FROM node:20-alpine

WORKDIR /app

# 只复制生产所需文件
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server/ ./server/
COPY --from=builder /app/dist ./dist

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

CMD ["node", "server/index.js"]
