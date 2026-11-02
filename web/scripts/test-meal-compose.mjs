import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const source = readFileSync(path.join(root, "src/components/MealFlowScreens.tsx"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
const load = (name) => {
  if (name === "react/jsx-runtime") return require(name);
  if (name === "react") return React;
  if (name === "@/lib/disabled") return { dis: () => ({}) };
  if (name === "@/components/Icons") return { ChevronLeft: () => null };
  if (name === "@/components/motion/primitives") return { PulseRing: () => null };
  if (name === "@/components/FuelCorrectionSheet") return { PortionPicker: () => null, macroAtPortion: () => "" };
  if (name === "@/lib/queries") return { useUpdateEntry: () => ({}) };
  throw new Error(`Unexpected import: ${name}`);
};
new Function("require", "module", "exports", compiled)(load, module, module.exports);
const { ComposeScreen, emptyComposeData } = module.exports;
const props = { onCancel() {}, onSubmit() {}, onSaveManual() {}, saving: false, onChange() {} };

const text = renderToStaticMarkup(React.createElement(ComposeScreen, {
  ...props, data: { ...emptyComposeData, text: "Pasta e uova" }, error: "Stima non riuscita",
}));
assert.match(text, /Pasta e uova/);
assert.match(text, /role="alert"[^>]*>Stima non riuscita/);

const manual = renderToStaticMarkup(React.createElement(ComposeScreen, {
  ...props, data: { ...emptyComposeData, mode: "manuale", description: "Cena", carb: "65", protein: "20", fat: "9", kcal: "421" }, error: "Salvataggio non riuscito",
}));
for (const value of ["Cena", "65", "20", "9", "421"]) assert.match(manual, new RegExp(`value="${value}"`));
assert.match(manual, /role="alert"[^>]*>Salvataggio non riuscito/);
console.log("Meal compose retains text, manual values, and visible errors.");
