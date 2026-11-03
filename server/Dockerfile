FROM public.ecr.aws/docker/library/node:24-slim
# Lambda Web Adapter: lets this same image run on Lambda (pattern 2). Inert on Fargate and AgentCore.
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 /lambda-adapter /opt/extensions/lambda-adapter
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js auth.js ./
ENV PORT=8000
EXPOSE 8000
USER node
CMD ["node", "server.js"]
