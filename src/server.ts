import { createServer } from "node:http";
import { createRequestHandler } from "./app.js";
import { loadConfig } from "./config.js";
import { S3ObjectStore } from "./object-store.js";
import { verifyUploadToken } from "./token.js";

const config = loadConfig();
const store = new S3ObjectStore({
  bucket: config.bucket,
  endpoint: config.endpoint,
  region: config.region,
  accessKeyId: config.accessKeyId,
  secretAccessKey: config.secretAccessKey,
  forcePathStyle: config.forcePathStyle,
});

const handler = createRequestHandler({
  store,
  verifyToken: (token) => verifyUploadToken(token, config.uploadSigningKey),
  maxUploadBytes: config.maxUploadBytes,
  ...(config.publicBaseUrl ? { publicBaseUrl: config.publicBaseUrl } : {}),
});

const server = createServer((request, response) => {
  void handler(request, response);
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`file-uploadr listening on port ${config.port}`);
});

function shutdown(): void {
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

