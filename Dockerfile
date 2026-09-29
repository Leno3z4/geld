FROM node:22-alpine AS build
WORKDIR /app

COPY package.json ./
RUN npm install --workspaces=false

COPY tsconfig.json ./
COPY src ./src
RUN npm run build:app
RUN npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist

RUN mkdir -p /app/data && adduser -D -u 10001 trader && chown -R trader:trader /app
USER trader

EXPOSE 8787
CMD ["node", "dist/src/container.js"]
