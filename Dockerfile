# Lightweight Node.js image for HTTP-based scraping (no browser needed)
FROM apify/actor-node:22

# Copy package files
COPY --chown=myuser:myuser package*.json ./

# Install NPM packages, skip optional and development dependencies
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
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
