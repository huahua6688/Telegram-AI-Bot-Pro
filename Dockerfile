FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV HEALTH_PORT=8080
ENV DATABASE_FILE=/data/bot-data.db
ENV DATA_FILE=/data/bot-data.json

COPY package*.json ./

RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev; \
    else \
      npm install --omit=dev; \
    fi

COPY . .

RUN mkdir -p /data

EXPOSE 8080

CMD ["npm", "start"]
