FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build --chown=node:node /app/ ./
ENV HOST=0.0.0.0 PORT=8080
USER node
EXPOSE 8080
CMD ["npm","start"]
