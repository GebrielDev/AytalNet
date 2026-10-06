# Debian (glibc), not Alpine (musl), for the build stage.
#
# Vite's bundler loads a platform-specific binary, @rollup/rollup-<platform>,
# which npm records in package-lock.json as an optional dependency for the
# platform the lockfile was generated on. web-dashboard/package-lock.json is
# written by developers and by CI, all of them glibc, so it carries
# @rollup/rollup-linux-x64-gnu and no musl build. On Alpine, npm then has
# nothing to install and the build dies with "Cannot find module
# @rollup/rollup-linux-x64-musl".
#
# Matching the build image to where the lockfile is produced is what keeps
# this fixed: regenerating the lockfile on any normal machine cannot
# reintroduce the mismatch. The runtime stage below stays on Alpine, since it
# only serves the built files and pulls in no platform binaries.
FROM node:20-slim AS builder

WORKDIR /app

# Build argument for API URL (set in Railway or pass with --build-arg)
ARG VITE_API_URL=https://api.startechsolutions.us/api
ENV VITE_API_URL=$VITE_API_URL

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build the application with embedded API URL
RUN echo "Building with VITE_API_URL=$VITE_API_URL" && npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install serve globally
RUN npm install -g serve

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Expose port (Railway will set PORT env var)
EXPOSE 3000

# Start serve with PORT environment variable
CMD ["sh", "-c", "serve -s dist -l ${PORT:-3000}"]
