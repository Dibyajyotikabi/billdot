FROM node:22-slim
ENV NODE_ENV=production DATA_DIR=/data PORT=4321 TRUST_PROXY=1 TZ=Asia/Kolkata
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:4321/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
