FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /data

ENV NODE_ENV=production
ENV PORT=8080
ENV HEALTH_PORT=8080
ENV DATABASE_FILE=/data/bot-data.db
ENV DATA_FILE=/data/bot-data.json

EXPOSE 8080

CMD ["npm", "start"]
