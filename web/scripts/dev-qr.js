"use strict";

const os = require("os");
const { spawn } = require("child_process");
const qrcode = require("qrcode-terminal");

function getLanIp() {
  const candidates = [];
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        candidates.push(net.address);
      }
    }
  }
  const preferred = candidates.find((ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip));
  return preferred ?? candidates[0] ?? null;
}

function getPort(argv) {
  const flagIndex = argv.findIndex((a) => a === "-p" || a === "--port");
  if (flagIndex !== -1 && argv[flagIndex + 1]) return argv[flagIndex + 1];
  const inline = argv.find((a) => /^(-p|--port)=/.test(a));
  if (inline) return inline.split("=")[1];
  return process.env.PORT || "3000";
}

const port = getPort(process.argv.slice(2));
const ip = getLanIp();

if (ip) {
  const url = `http://${ip}:${port}`;
  console.log(`\nScansiona per aprire l'app dal telefono (stessa rete WiFi):\n  ${url}\n`);
  qrcode.generate(url, { small: true });
  console.log("");
} else {
  console.warn("\nNessun indirizzo IP di rete locale trovato: l'app sarà raggiungibile solo da localhost.\n");
}

const nextBin = process.platform === "win32" ? "next.cmd" : "next";
const args = ["dev", ...process.argv.slice(2)];
const child = spawn(nextBin, args, { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
