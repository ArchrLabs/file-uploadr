import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { after, before, test } from "node:test";
import { createRequestHandler } from "../src/app.js";
import type {
  ObjectMetadata,
  ObjectStore,
  PutObjectInput,
  StoredObject,
} from "../src/object-store.js";
import { issueUploadToken, verifyUploadToken } from "../src/token.js";

class MemoryStore implements ObjectStore {
  readonly #objects = new Map<string, { body: Buffer; contentType: string }>();

  async put(input: PutObjectInput): Promise<{ etag: string }> {
    const chunks: Buffer[] = [];
    for await (const chunk of input.body) {
      chunks.push(Buffer.from(chunk));
    }
    this.#objects.set(input.key, {
      body: Buffer.concat(chunks),
      contentType: input.contentType,
    });
    return { etag: '"test-etag"' };
  }

  async get(key: string, range?: string): Promise<StoredObject | undefined> {
    const object = this.#objects.get(key);
    if (!object) return undefined;

    if (range) {
      const match = /^bytes=(\d+)-(\d+)?$/.exec(range);
      if (match?.[1]) {
        const start = Number(match[1]);
        const end = match[2] ? Number(match[2]) : object.body.byteLength - 1;
        const body = object.body.subarray(start, end + 1);
        return {
          body: Readable.from(body),
          contentType: object.contentType,
          contentLength: body.byteLength,
          contentRange: `bytes ${start}-${end}/${object.body.byteLength}`,
        };
      }
    }

    return {
      body: Readable.from(object.body),
      contentType: object.contentType,
      contentLength: object.body.byteLength,
    };
  }

  async head(key: string): Promise<ObjectMetadata | undefined> {
    const object = this.#objects.get(key);
    return object
      ? { contentType: object.contentType, contentLength: object.body.byteLength }
      : undefined;
  }
}

const signingKey = new TextEncoder().encode("a-secure-test-signing-key-with-32-bytes");
const store = new MemoryStore();
const server = createServer(
  createRequestHandler({
    store,
    verifyToken: (token) => verifyUploadToken(token, signingKey),
    maxUploadBytes: 12,
  }),
);
let baseUrl = "";
let token = "";
let uploadedUrl = "";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  token = await issueUploadToken(signingKey);
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

test("rejects uploads without a signed token", async () => {
  const response = await fetch(`${baseUrl}/private.txt`, { method: "PUT", body: "secret" });
  assert.equal(response.status, 401);
});

test("uploads a file and returns its public URL", async () => {
  const response = await fetch(`${baseUrl}/folder/hello%20world.txt`, {
    method: "PUT",
    headers: {
      "x-upload-token": token,
      "content-type": "text/plain",
    },
    body: "hello world",
  });
  uploadedUrl = await response.text();

  assert.equal(response.status, 201);
  assert.match(uploadedUrl, new RegExp(`^${baseUrl}/folder/hello-world-[A-Za-z\\d_-]{8}\\.txt$`));
  assert.equal(response.headers.get("location"), uploadedUrl);
  assert.equal(response.headers.get("x-upload-size"), "11");
  assert.match(response.headers.get("x-content-sha256") ?? "", /^[a-f\d]{64}$/);

  const download = await fetch(uploadedUrl);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-type"), "text/plain");
  assert.equal(download.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(await download.text(), "hello world");
});

test("supports byte ranges for video and other media", async () => {
  const response = await fetch(uploadedUrl, {
    headers: { range: "bytes=6-10" },
  });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 6-10/11");
  assert.equal(await response.text(), "world");
});

test("creates unique URLs and infers media types from filenames", async () => {
  const upload = () =>
    fetch(`${baseUrl}/Demo%20Screenshot.PNG`, {
      method: "PUT",
      headers: { "x-upload-token": token },
      body: new Uint8Array([137, 80, 78, 71]),
    });

  const first = await upload();
  const second = await upload();
  const firstUrl = await first.text();
  const secondUrl = await second.text();

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.notEqual(firstUrl, secondUrl);
  assert.match(firstUrl, new RegExp(`^${baseUrl}/demo-screenshot-[A-Za-z\\d_-]{8}\\.png$`));

  const download = await fetch(firstUrl);
  assert.equal(download.headers.get("content-type"), "image/png");
});

test("rejects oversized and path-traversing uploads", async () => {
  const oversized = await fetch(`${baseUrl}/large.bin`, {
    method: "PUT",
    headers: { "x-upload-token": token },
    body: "more than twelve bytes",
  });
  assert.equal(oversized.status, 413);

  const traversal = await fetch(`${baseUrl}/%2e%2e%2fsecret`, {
    method: "PUT",
    headers: { "x-upload-token": token },
    body: "nope",
  });
  assert.equal(traversal.status, 400);
});

test("rejects a tampered signed token", async () => {
  const response = await fetch(`${baseUrl}/private.txt`, {
    method: "PUT",
    headers: { "x-upload-token": `${token}tampered` },
    body: "secret",
  });
  assert.equal(response.status, 401);
});
