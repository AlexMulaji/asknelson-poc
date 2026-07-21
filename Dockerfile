# ---- build stage: compile the Vite/React PWA -------------------------------
FROM node:20-alpine AS build
WORKDIR /app

# better-sqlite3 is a native addon. Prebuilt binaries usually cover
# linux-musl/x64, but these build tools are a safety net for platforms that
# need to compile from source. Removed again after install to keep layers lean.
RUN apk add --no-cache --virtual .build-deps python3 make g++
COPY package.json package-lock.json* ./
RUN npm install
RUN apk del .build-deps

COPY . .
RUN npm run build

# ---- runtime stage: Express serves the build + content API -----------------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/app/data

RUN apk add --no-cache --virtual .build-deps python3 make g++
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
RUN apk del .build-deps

COPY server ./server
# Seed content: first boot copies these into DATA_DIR (the volume).
COPY src/data ./src/data
COPY --from=build /app/dist ./dist

# Persist admin edits outside the container. Pre-create the directory owned by
# the runtime user so the volume inherits writable permissions.
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data

EXPOSE 8080
USER node
CMD ["node", "server/index.js"]
