FROM node:22-alpine
RUN apk add --no-cache docker-cli
WORKDIR /app
COPY server.js ./server.js
CMD ["node", "server.js"]
