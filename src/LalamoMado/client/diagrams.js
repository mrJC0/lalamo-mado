// Mermaid is heavy, so it loads only for docs that contain a diagram.
// The rendered SVG replaces the contents of <pre class="mermaid"> but keeps the element and its data-src-* offsets,
// so a selection inside a diagram still maps to the fenced block's source lines.

const MERMAID_SCRIPT = "/vendor/mermaid-12.1.0.min.js";
let loading;

export async function renderDiagrams(root) {
  const blocks = [...root.querySelectorAll("pre.mermaid")];
  if (blocks.length === 0) return;
  const mermaid = await load();
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default" });
  try {
    await mermaid.run({ nodes: blocks, suppressErrors: true });
  } catch (error) {
    console.warn("mermaid:", error);
  }
}

function load() {
  return (loading ??= new Promise((resolve, reject) => {
    const script = Object.assign(document.createElement("script"), { src: MERMAID_SCRIPT });
    script.onload = () => resolve(globalThis.mermaid);
    script.onerror = () => reject(new Error("mermaid failed to load"));
    document.head.append(script);
  }));
}
