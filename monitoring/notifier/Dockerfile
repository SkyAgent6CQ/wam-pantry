FROM node:22-alpine
RUN apk upgrade --no-cache && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
WORKDIR /app
COPY --chown=node:node server.js .
USER node
EXPOSE 9095
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://127.0.0.1:9095/health > /dev/null || exit 1
CMD ["node", "server.js"]
