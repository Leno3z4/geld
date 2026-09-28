FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY webapp/package.json ./webapp/package.json
RUN npm install
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/webapp/dist ./webapp/dist
RUN adduser -D -u 10001 trader
USER trader
EXPOSE 8787
CMD ["node", "dist/src/index.js"]
