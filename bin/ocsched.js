#!/usr/bin/env node
import { main } from "../src/main.js";

main().catch((error) => {
  console.error(`ocsched: ${error.message}`);
  if (process.env.DEBUG) console.error(error.stack);
  process.exitCode = 1;
});
