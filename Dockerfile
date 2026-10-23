FROM node:22-alpine
WORKDIR /app
COPY scripts/package*.json ./
RUN npm ci --omit=dev
COPY scripts/crank.js ./
CMD ["node", "crank.js"]
