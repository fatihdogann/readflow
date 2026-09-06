// Mock coding-agent CLI: stdin'den prompt okur, stdout'a deterministik markdown yazar.
// Kullanım: READFLOW_AGENT_CMD="node scripts/mock-agent.mjs" pnpm dev:worker
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  const prompt = input.trim();
  const excerpt = prompt.slice(-300).replace(/\s+/g, " ");
  let output;
  if (prompt.includes("[GÖREV: ÖZET")) {
    output = [
      "## Mock Özet (Normal)",
      "",
      `- Kaynak uzunluğu: ${prompt.length} karakter`,
      `- Girdiden kesit: ${excerpt.slice(0, 140)}…`,
      "",
      "Bu çıktı scripts/mock-agent.mjs tarafından üretildi; gerçek bir agent değildir.",
    ].join("\n");
  } else {
    output = [
      "## Mock Düzenleme",
      "",
      `Girdi ${prompt.length} karakter olarak alındı ve bölümledi (mock).`,
      "",
      "### Birinci Bölüm",
      "",
      excerpt.slice(0, 180),
      "",
      "### İkinci Bölüm",
      "",
      "- Mock madde bir",
      "- Mock madde iki",
      "",
      "Bu çıktı scripts/mock-agent.mjs tarafından üretildi; gerçek bir agent değildir.",
    ].join("\n");
  }
  process.stdout.write(output);
});
