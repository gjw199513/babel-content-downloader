#!/usr/bin/env node
import { ASR_CLI_USAGE, asrCliSummary, runAsrCli } from "../dist/runtime/asr/cli.js";

if (process.argv.slice(2).some((argument) => argument === "--help" || argument === "-h")) {
  process.stdout.write(`${ASR_CLI_USAGE}\n`);
  process.exit(0);
}

try {
  const result = await runAsrCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(asrCliSummary(result), null, 2)}\n`);
} catch (error) {
  const value = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${value}\n`);
  process.exitCode = 1;
}
