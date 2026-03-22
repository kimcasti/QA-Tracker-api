FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json* yarn.lock* ./

RUN if [ -f package-lock.json ]; then npm ci; else yarn install --frozen-lockfile; fi

FROM node:20-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app ./

EXPOSE 1337

CMD ["npm", "run", "start"]
