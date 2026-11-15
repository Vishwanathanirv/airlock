// The browser demo runs the same classifier: copy the trained model next to the web app.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(resolve(root, "apps/web/public"), { recursive: true });
copyFileSync(resolve(root, "models/classifier.json"), resolve(root, "apps/web/public/classifier.json"));
