FROM node:20-alpine

WORKDIR /app

# Static page only - no build step, no dependencies to install
RUN npm install -g serve

COPY public ./public

EXPOSE 3000

# No -s: this is a multi-page static site, not a SPA. The -s flag rewrites
# every unmatched path to index.html, which made /privacy serve the landing
# page. Plain serve resolves /privacy to privacy.html.
CMD ["sh", "-c", "serve public -l ${PORT:-3000}"]
