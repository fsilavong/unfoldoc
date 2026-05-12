FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine

RUN apk add --no-cache git

WORKDIR /app

COPY --from=build /app/dist ./dist
COPY --from=build /app/static ./static
COPY --from=build /app/server.mjs ./server.mjs

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV UNFOLDOC_ALLOW_SOURCE_CHANGE=false

EXPOSE 3000

CMD ["node", "server.mjs"]
