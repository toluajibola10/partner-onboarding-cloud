FROM node:18-slim

# puppeteer -- backward compat libs
RUN apt-get update && \
    apt-get install -y \
        chromium libatk-bridge2.0-0 libxkbcommon0 libgtk-3-0 libnss3 libgbm1 \
        --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --omit=dev          # ← changed

COPY . .

ENV PORT=5000 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

EXPOSE 5000
CMD ["npm","start"]
