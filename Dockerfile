# --- build stage ---
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.json ./
COPY src ./src

RUN npm ci --omit=dev && npm ci --omit=dev --ignore-scripts && npm install -D typescript@5.9.3 && npx tsc

# --- runtime stage ---
FROM node:22-alpine
WORKDIR /app

RUN apk add --no-cache tini \
  && addgroup -S app && adduser -S app -G app \
  && chown app:app /app
USER app

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --chown=app:app package.json ./

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/http.js"]