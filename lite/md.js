// Minimal, sikker markdown → HTML. Al tekst escapes først, så modellens output aldrig kan indsætte HTML/script.
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

export function md(src) {
  const parts = String(src || "").split(/```[a-zA-Z0-9]*\n?/);
  let html = "";
  parts.forEach((part, i) => {
    if (i % 2 === 1) { html += `<pre><code>${esc(part.replace(/\n$/, ""))}</code></pre>`; return; }
    const lines = esc(part).split("\n");
    let list = null;
    const close = () => { if (list) { html += `</${list}>`; list = null; } };
    for (const line of lines) {
      let m;
      if ((m = line.match(/^(#{1,4})\s+(.*)/))) { close(); html += `<h${m[1].length + 2}>${inline(m[2])}</h${m[1].length + 2}>`; }
      else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { if (list !== "ul") { close(); html += "<ul>"; list = "ul"; } html += `<li>${inline(m[1])}</li>`; }
      else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== "ol") { close(); html += "<ol>"; list = "ol"; } html += `<li>${inline(m[1])}</li>`; }
      else if (/^\|.*\|$/.test(line.trim())) {
        close();
        if (/^\|[\s:|-]+\|$/.test(line.trim())) continue;
        html += "<div class='tr'>" + line.trim().slice(1, -1).split("|").map((c) => `<span>${inline(c.trim())}</span>`).join("") + "</div>";
      }
      else if (line.trim() === "") { close(); }
      else { close(); html += `<p>${inline(line)}</p>`; }
    }
    close();
  });
  return html;
}
