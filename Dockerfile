# Fafnir Bot - GalaChain Arbitrage Bot
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

# Copy package files
COPY package*.json ./

# Install dependencies (including dev dependencies for tsx)
RUN npm ci

# Copy source code
COPY . .

# Create logs directory
RUN mkdir -p logs/dryruns

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S fafnir -u 1001
RUN chown -R fafnir:nodejs /app
USER fafnir

# Expose port (if you add web monitoring later)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "console.log('Bot is running')" || exit 1

# Start the enhanced bot
CMD ["npm", "run", "start:enhanced"]
