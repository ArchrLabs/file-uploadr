import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { contentTypeForUpload } from "./content-type.js";
import {
  encodeObjectKey,
  InvalidObjectKeyError,
  objectKeyFromPathname,
  uniqueObjectKey,
} from "./object-key.js";
import type { ObjectMetadata, ObjectStore } from "./object-store.js";

const CACHE_CONTROL = "public, max-age=31536000, immutable";

class UploadTooLargeError extends Error {}

class UploadBody extends Transform {
  #bytes = 0;
  readonly #hash = createHash("sha256");

  constructor(private readonly maxBytes: number) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ): void {
    this.#bytes += chunk.byteLength;
    if (this.#bytes > this.maxBytes) {
      callback(new UploadTooLargeError(`Upload exceeds ${this.maxBytes} bytes`));
      return;
    }

    this.#hash.update(chunk);
    callback(null, chunk);
  }

  get byteLength(): number {
    return this.#bytes;
  }

  digest(): string {
    return this.#hash.digest("hex");
  }
}

export interface AppOptions {
  store: ObjectStore;
  verifyToken(token: string): Promise<boolean>;
  maxUploadBytes: number;
  publicBaseUrl?: string;
}

function sendJson(response: ServerResponse, status: number, body: object): void {
  const content = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(content),
    "cache-control": "no-store",
  });
  response.end(content);
}

function setMetadataHeaders(response: ServerResponse, metadata: ObjectMetadata): void {
  response.setHeader("content-type", metadata.contentType);
  response.setHeader("cache-control", CACHE_CONTROL);
  response.setHeader("accept-ranges", "bytes");
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("x-content-type-options", "nosniff");
  if (metadata.contentLength !== undefined) {
    response.setHeader("content-length", metadata.contentLength);
  }
  if (metadata.etag !== undefined) {
    response.setHeader("etag", metadata.etag);
  }
  if (metadata.lastModified !== undefined) {
    response.setHeader("last-modified", metadata.lastModified.toUTCString());
  }
}

function parseContentLength(request: IncomingMessage): number | undefined {
  const raw = request.headers["content-length"];
  if (raw === undefined) {
    return undefined;
  }

  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function uploadToken(request: IncomingMessage): string | undefined {
  const value = request.headers["x-upload-token"];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requestBaseUrl(request: IncomingMessage, configuredBaseUrl?: string): string {
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  const forwardedHost = request.headers["x-forwarded-host"];
  const host = typeof forwardedHost === "string" ? forwardedHost : request.headers.host;
  const forwardedProto = request.headers["x-forwarded-proto"];
  const protocol = typeof forwardedProto === "string" ? forwardedProto : "http";
  return `${protocol}://${host ?? "localhost"}`;
}

async function handleUpload(
  request: IncomingMessage,
  response: ServerResponse,
  requestedKey: string,
  options: AppOptions,
): Promise<void> {
  const token = uploadToken(request);
  if (!token || !(await options.verifyToken(token))) {
    request.resume();
    sendJson(response, 401, { error: "Invalid upload token" });
    return;
  }

  const contentLength = parseContentLength(request);
  if (contentLength !== undefined && contentLength > options.maxUploadBytes) {
    request.resume();
    sendJson(response, 413, { error: `Upload exceeds ${options.maxUploadBytes} bytes` });
    return;
  }

  const body = new UploadBody(options.maxUploadBytes);
  request.pipe(body);

  try {
    const key = uniqueObjectKey(requestedKey);
    const result = await options.store.put({
      key,
      body,
      contentType: contentTypeForUpload(key, request.headers["content-type"]),
      ...(contentLength !== undefined ? { contentLength } : {}),
    });
    const baseUrl = requestBaseUrl(request, options.publicBaseUrl);
    const publicUrl = `${baseUrl}/${encodeObjectKey(key)}`;
    const sha256 = body.digest();
    response.writeHead(201, {
      "content-type": "text/plain; charset=utf-8",
      "content-length": Buffer.byteLength(publicUrl),
      "cache-control": "no-store",
      location: publicUrl,
      "x-content-sha256": sha256,
      "x-upload-size": body.byteLength,
      ...(result.etag !== undefined ? { etag: result.etag } : {}),
    });
    response.end(publicUrl);
  } catch (error) {
    request.unpipe(body);
    request.resume();
    if (error instanceof UploadTooLargeError) {
      sendJson(response, 413, { error: error.message });
      return;
    }
    throw error;
  }
}

async function handleDownload(
  request: IncomingMessage,
  response: ServerResponse,
  key: string,
  options: AppOptions,
): Promise<void> {
  if (request.method === "HEAD") {
    const metadata = await options.store.head(key);
    if (!metadata) {
      sendJson(response, 404, { error: "File not found" });
      return;
    }
    setMetadataHeaders(response, metadata);
    response.writeHead(200);
    response.end();
    return;
  }

  const range = request.headers.range;
  const object = await options.store.get(key, range);
  if (!object) {
    sendJson(response, 404, { error: "File not found" });
    return;
  }

  setMetadataHeaders(response, object);
  if (object.contentRange) {
    response.setHeader("content-range", object.contentRange);
    response.writeHead(206);
  } else {
    response.writeHead(200);
  }
  await pipeline(object.body, response);
}

export function createRequestHandler(options: AppOptions) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      const requestTarget = request.url ?? "/";
      const queryIndex = requestTarget.indexOf("?");
      const pathname = queryIndex === -1 ? requestTarget : requestTarget.slice(0, queryIndex);

      if (pathname === "/healthz") {
        if (request.method !== "GET") {
          response.writeHead(405, { allow: "GET" });
          response.end();
          return;
        }
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, HEAD, OPTIONS",
          "access-control-allow-headers": "Range",
        });
        response.end();
        return;
      }

      const key = objectKeyFromPathname(pathname);
      if (request.method === "PUT") {
        await handleUpload(request, response, key, options);
        return;
      }
      if (request.method === "GET" || request.method === "HEAD") {
        await handleDownload(request, response, key, options);
        return;
      }

      response.writeHead(405, { allow: "GET, HEAD, PUT, OPTIONS" });
      response.end();
    } catch (error) {
      if (error instanceof InvalidObjectKeyError) {
        sendJson(response, 400, { error: error.message });
        return;
      }

      console.error(error);
      if (!response.headersSent) {
        sendJson(response, 500, { error: "Internal server error" });
      } else {
        response.destroy();
      }
    }
  };
}
