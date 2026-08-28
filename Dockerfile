# Lightweight Node.js image for HTTP-based scraping (no browser needed)
FROM apify/actor-node:22

# Copy package files
COPY --chown=myuser:myuser package*.json ./

# Install production packages, including Impit's native optional binary
RUN npm --quiet set progress=false \
    && npm install --omit=dev --include=optional \
    && node -e "import('impit').then(() => console.log('impit OK'))" \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true) \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version \
    && rm -r ~/.npm

# Copy source files
COPY --chown=myuser:myuser . ./

CMD npm start --silent
