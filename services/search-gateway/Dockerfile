FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32
WORKDIR /app
COPY services/search-gateway/package*.json ./
RUN npm ci --omit=dev
COPY services/search-gateway/*.mjs ./
COPY services/search-gateway/THIRD_PARTY_NOTICES.md ./
ENV SEARCH_HOST=0.0.0.0
ENV SEARCH_PORT=8788
USER node
EXPOSE 8788
CMD ["node", "server.mjs"]
