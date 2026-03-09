const fs = require("fs");

const inFile  = process.argv[2] || "la_zenia_L0_v1.json";
const outFile = process.argv[3] || "la_zenia_L0_v1.clean.json";

let s = fs.readFileSync(inFile, "utf8");

// remove UTF-8 BOM if present
s = s.replace(/^\uFEFF/, "");

let r1 = 0, r2 = 0, r3 = 0;

// 1) fix ": .123" / ": -.123" / ": .0"  -> ":0.123" / ":-0.123" / ":0.0"
s = s.replace(/:\s*([+-]?)\.(\d+)/g, (_, sign, dec) => { r1++; return ":" + sign + "0." + dec; });

// 2) fix ": 12." / ": -3." -> ":12.0" / ":-3.0"
s = s.replace(/:\s*([+-]?\d+)\.(?=\s*[,}])/g, (_, n) => { r2++; return ":" + n + ".0"; });

// 3) fix ": ." / ": -." (rare) -> ":0.0" / ":-0.0"
s = s.replace(/:\s*([+-]?)\.(?=\s*[,}])/g, (_, sign) => { r3++; return ":" + sign + "0.0"; });

fs.writeFileSync(outFile, s, "utf8");

try {
  JSON.parse(s);
  console.log("CLEAN JSON OK");
  console.log("WROTE:", outFile);
  console.log("replacements r1(.d):", r1, "r2(d.):", r2, "r3(.) :", r3);
} catch (e) {
  console.log("STILL INVALID JSON:", e.message);
  // try to show context around first position number if present
  const m = String(e.message).match(/position\s+(\d+)/i);
  if (m) {
    const pos = parseInt(m[1], 10);
    const start = Math.max(0, pos - 120);
    const end = Math.min(s.length, pos + 120);
    console.log("---- context ----");
    console.log(s.slice(start, end));
    console.log("-----------------");
  }
  process.exit(1);
}
