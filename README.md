# file-uploadr

A small upload server you host on Railway. `PUT` a file with a signed token and get a permanent public URL back. Files sit in a private Railway Storage Bucket, and the service streams them to anyone with the link, with byte-range support so videos can seek.

It was built for coding agents that attach screenshots and screen recordings to pull requests. The agent holds a revocable upload token and never sees bucket credentials.

```bash
curl -sS --fail-with-body -X PUT -T ./demo.mp4 \
  -H "X-Upload-Token: $FILE_HOST_TOKEN" \
  "$FILE_HOST_URL/demo.mp4"
# https://files.example.com/demo-a8K2mPqZ.mp4
```

## Deploy on Railway

You need a Railway account, the [Railway CLI](https://docs.railway.com/cli), Node.js 22 or newer, and pnpm.

1. Fork this repository.
2. Create a Railway project and add a GitHub Repo service pointing at your fork. Railway builds it with Railpack and needs no config file. The first deploy crashes until the variables below exist.
3. Add a Storage Bucket to the same project and name it `uploads`.
4. In the service's Variables tab, open the Raw Editor and paste:

   ```text
   S3_BUCKET=${{uploads.BUCKET}}
   S3_ENDPOINT=${{uploads.ENDPOINT}}
   S3_REGION=${{uploads.REGION}}
   S3_ACCESS_KEY_ID=${{uploads.ACCESS_KEY_ID}}
   S3_SECRET_ACCESS_KEY=${{uploads.SECRET_ACCESS_KEY}}
   ```

   Replace `uploads` if your bucket has a different name. If the bucket's Credentials tab says to use path-style URLs, add `S3_URL_STYLE=path` too.
5. In the service's Settings, set the healthcheck path to `/healthz` and generate a public domain under Networking.
6. From a local clone, create the signing key and your first upload token:

   ```bash
   pnpm install
   railway link
   pnpm token:provision --service <service-name>
   ```

   The script generates a random 48-byte key and pipes it to Railway as `UPLOAD_SIGNING_KEY`, so the key never touches your disk. It writes a token signed with that key to `.file-host-token`, which is gitignored and mode `0600`. `--service` defaults to `file-uploadr`.
7. Deploy the pending changes from the dashboard, or run `railway redeploy --service <service-name>`.

Check that it's up:

```bash
export FILE_HOST_URL="https://<your-domain>"
curl -fsS "$FILE_HOST_URL/healthz"
# {"ok":true}
```

A custom domain needs no code change. Add it under Networking, and upload responses will use whichever hostname the request came in on. Set `PUBLIC_BASE_URL` if you want every returned URL to use one hostname.

## Upload

```bash
export FILE_HOST_TOKEN="$(<.file-host-token)"

curl -sS --fail-with-body -X PUT -T ./example.mp4 \
  -H "X-Upload-Token: $FILE_HOST_TOKEN" \
  "$FILE_HOST_URL/example.mp4"
```

A successful upload returns `201 Created` with the public URL as the plain-text body and in `Location`. `X-Content-SHA256` and `X-Upload-Size` report what the server received.

The server slugifies the filename and appends a random 8-character suffix, so uploading `Demo Screenshot.PNG` twice gives two URLs like `demo-screenshot-Xk3_9aQe.png`. Folders in the path are kept, so `/pr-42/before.png` stays under `pr-42/`. If the request has no `Content-Type` or a generic one, the server picks one from the file extension for common image, video, audio, and document types.

## Download

Downloads need no token.

```bash
curl -fLO "$FILE_HOST_URL/example-a8K2mPqZ.mp4"
```

`GET` and `HEAD` both work, and `GET` honors `Range`. Responses send `Cache-Control: public, max-age=31536000, immutable`, an `ETag`, and `Access-Control-Allow-Origin: *`.

## Tokens

Upload tokens are HS256 JWTs bound to this service's issuer, audience, and `upload` scope. They don't expire unless you ask for it. Treat one like a password.

To mint another token with the key already on Railway:

```bash
railway run --service <service-name> -- pnpm token:issue --subject ci-bot --expires-in 30d
```

There is no per-token revocation. Rotating the signing key invalidates every token at once:

```bash
pnpm token:provision --service <service-name>
railway redeploy --service <service-name>
```

This overwrites `.file-host-token` with a token for the new key. Re-issue any other tokens you still need.

## Configuration

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `UPLOAD_SIGNING_KEY` | yes | | At least 32 bytes. `pnpm token:provision` sets it. |
| `S3_BUCKET` | yes | | |
| `S3_ENDPOINT` | yes | | |
| `S3_ACCESS_KEY_ID` | yes | | |
| `S3_SECRET_ACCESS_KEY` | yes | | |
| `S3_REGION` | no | `auto` | |
| `S3_URL_STYLE` | no | `virtual` | `path` switches to path-style bucket URLs. |
| `PUBLIC_BASE_URL` | no | request host | Base for returned URLs. Without it the server uses `X-Forwarded-Host` (or `Host`) and `X-Forwarded-Proto`. |
| `MAX_UPLOAD_BYTES` | no | `5368709120` (5 GiB) | |
| `PORT` | no | `3000` | Railway sets this for you. |

The server speaks plain S3, so the `S3_*` variables can point at any S3-compatible store, not only a Railway bucket.

## Limits and costs

- Railway gives each request body [five minutes](https://docs.railway.com/networking/public-networking/specs-and-limits) to finish uploading, so the practical size limit depends on the uploader's bandwidth.
- Railway buckets [can't be public](https://docs.railway.com/storage-buckets), so every download streams through the service. Bucket egress is free. Service egress is billed.
- The service serves files with the `Content-Type` the uploader chose, including `text/html` and `image/svg+xml`. Anyone with a token can publish a page that runs scripts on your file domain. Give the service a dedicated domain, not a subdomain of a site whose cookies matter.

## Local development

```bash
cp .env.example .env   # add bucket credentials and a signing key
pnpm install
pnpm dev
```

`pnpm dev` reads `.env` when it exists. The tests use an in-memory store and need no credentials.

```bash
pnpm typecheck
pnpm test
pnpm build
```

## How it works

One Node HTTP server, no framework. Only `PUT` checks `X-Upload-Token`. The upload body passes through a transform that counts and hashes bytes, then goes to the bucket as an S3 multipart upload, so the server never holds a whole file in memory. Object keys are validated before use, which rejects `.` and `..` segments, empty segments, backslashes, control characters, and keys over 1024 bytes.

## License

[MIT](LICENSE)
