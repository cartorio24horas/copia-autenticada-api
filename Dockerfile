FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --production

# Instala WebKit E todas as dependências do sistema automaticamente
RUN npx playwright install --with-deps webkit

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
