
FROM node:20-bookworm-slim

# Install the Linux C++ compiler
RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node.js dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy the application source
COPY . .

# Compile the C++ engine for Linux
RUN npm run build:cpp

# Render needs the server exposed on all interfaces
ENV HOST=0.0.0.0

EXPOSE 10000

CMD ["node", "server/index.js"]