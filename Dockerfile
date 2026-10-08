FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
# tokens.json (auto-refreshed Meta tokens) lives here — mount a volume so it survives redeploys
VOLUME ["/app/data"]
CMD ["node", "src/index.js"]
