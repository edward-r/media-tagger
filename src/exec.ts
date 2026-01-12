import { spawn } from "node:child_process";

export type ExecResult = Readonly<{
  code: number;
  stdout: string;
  stderr: string;
}>;

export const exec = async (
  cmd: string,
  args: readonly string[],
): Promise<ExecResult> =>
  await new Promise<ExecResult>((resolve) => {
    const child = spawn(cmd, [...args], { stdio: ["ignore", "pipe", "pipe"] });

    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    child.stdout.on("data", (b: Buffer) => outChunks.push(b));
    child.stderr.on("data", (b: Buffer) => errChunks.push(b));

    child.on("close", (code) => {
      resolve({
        code: typeof code === "number" ? code : 1,
        stdout: Buffer.concat(outChunks).toString("utf8"),
        stderr: Buffer.concat(errChunks).toString("utf8"),
      });
    });
  });
