# The whole product in one image: the customer's page, the claims desk and the API that
# receives what the page sends, on one port. Settings are read at startup, so one built
# image serves any insurer — see server/claim-server.mjs for the list.
#
#   docker build -t claim-marker .
#   docker run -p 8788:8788 -v claims:/data claim-marker

FROM node:24-alpine AS build
WORKDIR /app
# the lockfile alone first, so a dependency-free edit reuses this layer
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
# only what is served and what serves it: no node_modules, no sources, no toolchain
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/package.json ./package.json
RUN mkdir -p /data/claims && chown -R node:node /data
USER node
ENV PORT=8788 CLAIM_DIR=/data/claims
EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8788)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/claim-server.mjs"]
