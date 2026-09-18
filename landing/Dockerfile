FROM node:20-alpine

WORKDIR /app

# Static page only - no build step, no dependencies to install
RUN npm install -g serve

COPY public ./public

EXPOSE 3000

CMD ["sh", "-c", "serve -s public -l ${PORT:-3000}"]
