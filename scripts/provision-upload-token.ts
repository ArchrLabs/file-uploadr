import { randomBytes } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { issueUploadToken } from "../src/token.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function setRailwaySigningKey(service: string, signingKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "railway",
      ["variable", "set", "--service", service, "--skip-deploys", "--stdin", "UPLOAD_SIGNING_KEY"],
      { stdio: ["pipe", "inherit", "inherit"] },
    );
    child.stdin.end(signingKey);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`railway variable set exited with code ${code ?? "unknown"}`));
    });
  });
}

const service = argument("--service") ?? "file-uploadr";
const outputPath = argument("--output") ?? ".file-host-token";
const signingKey = randomBytes(48).toString("base64url");
const token = await issueUploadToken(new TextEncoder().encode(signingKey));

await setRailwaySigningKey(service, signingKey);
await writeFile(outputPath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
await chmod(outputPath, 0o600);

console.log(`Provisioned a new signing key and wrote the upload token to ${outputPath}`);
