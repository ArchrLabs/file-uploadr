import { issueUploadToken } from "../src/token.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const rawKey = process.env.UPLOAD_SIGNING_KEY;
if (!rawKey || Buffer.byteLength(rawKey) < 32) {
  throw new Error("Set UPLOAD_SIGNING_KEY to the same 32+ byte secret used by the service");
}

const expiresIn = argument("--expires-in");
const token = await issueUploadToken(new TextEncoder().encode(rawKey), {
  subject: argument("--subject") ?? "owner",
  ...(expiresIn ? { expiresIn } : {}),
});

process.stdout.write(`${token}\n`);

