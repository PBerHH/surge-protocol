FROM node:22-alpine
WORKDIR /app
COPY scripts/package*.json ./
RUN npm ci --omit=dev
COPY scripts/points-worker.js ./
CMD ["node", "points-worker.js"]
