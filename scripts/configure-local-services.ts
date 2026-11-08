import { fileURLToPath } from "node:url";
import { configureLocalEnvironment } from "../helpers/environment-setup.ts";

await configureLocalEnvironment(fileURLToPath(new URL("../.env", import.meta.url)));
console.log(
  "Prepared ignored .env with local service credentials and empty provider fields. Existing values are preserved.",
);
