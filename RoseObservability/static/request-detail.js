const esc = (s) => {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
};

const fmtMs = (ms) => {
  if (ms == null) return "–";
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

const fmtTime = (iso) => {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

function getTraceId() {
  const m = window.location.pathname.match(/\/request\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function renderHeader(req) {
  if (!req) {
    return `<p class="text-slate-400">No request metadata yet — events only.</p>`;
  }
  return `
    <div class="flex flex-wrap items-center gap-4">
      <span class="badge badge-${esc(req.service)}">${esc(req.service)}</span>
      <span class="font-mono text-sm">${esc(req.endpoint)}</span>
      <span class="badge badge-${esc(req.status)}">${esc(req.status)}</span>
      <span class="text-sm text-slate-400">${fmtMs(req.duration_ms)}</span>
    </div>
    <p class="text-xs text-slate-500 mt-2">trace_id <code>${esc(req.trace_id)}</code></p>
    <p class="text-xs text-slate-500">${esc(req.started_at)}</p>
  `;
}

function renderPromptBuilt(payload) {
  const skills = payload.selected_skills || [];
  const chips = skills.map((s) => `<span class="chip">${esc(s)}</span>`).join("") ||
    `<span class="text-xs text-slate-500">no skills selected</span>`;
  const knowledgeChars = payload.knowledge_chars ?? "?";
  return `
    <div>
      <p class="text-xs text-slate-400 uppercase mb-1">Selected skills</p>
      <div class="mb-3">${chips}</div>
      <p class="text-xs text-slate-400 uppercase mb-1">Knowledge injected (${esc(knowledgeChars)} chars)</p>
      <details class="mb-3"><summary class="text-xs text-slate-400">preview</summary>
        <pre class="text-xs bg-slate-950 border border-slate-800 rounded p-2 mt-1">${esc(payload.knowledge_preview || "")}</pre>
      </details>
      <p class="text-xs text-slate-400 uppercase mb-1">System prompt</p>
      <pre class="text-xs bg-slate-950 border border-slate-800 rounded p-2">${esc(payload.system_prompt || "")}</pre>
    </div>
  `;
}

function renderToolCall(payload) {
  const params = JSON.stringify(payload.params ?? {}, null, 2);
  return `
    <p class="text-sm">
      <span class="font-mono font-semibold text-rose-300">${esc(payload.tool)}</span>
      <span class="text-xs text-slate-500 ml-2">iteration ${esc(payload.iteration ?? "?")}</span>
    </p>
    <details class="mt-1"><summary class="text-xs text-slate-400">params</summary>
      <pre class="text-xs bg-slate-950 border border-slate-800 rounded p-2 mt-1">${esc(params)}</pre>
    </details>
  `;
}

function renderToolResult(payload) {
  const ok = payload.success ? "ok" : "error";
  const body = payload.success
    ? esc(payload.content || "")
    : esc(payload.error || "(no error message)");
  return `
    <p class="text-sm">
      <span class="font-mono font-semibold text-rose-300">${esc(payload.tool)}</span>
      <span class="badge badge-${ok} ml-2">${ok}</span>
    </p>
    <details class="mt-1" open><summary class="text-xs text-slate-400">output</summary>
      <pre class="text-xs bg-slate-950 border border-slate-800 rounded p-2 mt-1">${body}</pre>
    </details>
  `;
}

function renderLibraryRequest(payload) {
  const q = payload.query || {};
  const rs = payload.response_summary || {};
  return `
    <div class="flex flex-wrap gap-3 text-xs text-slate-400 mb-2">
      <span>${esc(payload.method || "")} <code>${esc(payload.endpoint || "")}</code></span>
      <span>status ${esc(payload.status_code ?? "?")}</span>
    </div>
    <p class="text-xs text-slate-400 uppercase mb-1">Query</p>
    <pre class="text-xs bg-slate-950 border border-slate-800 rounded p-2 mb-3">${esc(JSON.stringify(q, null, 2))}</pre>
    <p class="text-xs text-slate-400 uppercase mb-1">Response summary</p>
    <pre class="text-xs bg-slate-950 border border-slate-800 rounded p-2">${esc(JSON.stringify(rs, null, 2))}</pre>
  `;
}

function renderEventBody(ev) {
  const p = ev.payload || {};
  switch (ev.event_type) {
    case "prompt_built": return renderPromptBuilt(p);
    case "tool_call": return renderToolCall(p);
    case "tool_result": return renderToolResult(p);
    case "request": return renderLibraryRequest(p);
    default:
      return `<pre class="text-xs bg-slate-950 border border-slate-800 rounded p-2">${esc(JSON.stringify(p, null, 2))}</pre>`;
  }
}

function renderEvent(ev) {
  return `
    <li class="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
          <span class="badge">${esc(ev.event_type)}</span>
          <span class="text-xs text-slate-500">${fmtTime(ev.timestamp)}</span>
        </div>
        ${ev.duration_ms != null ? `<span class="text-xs text-slate-400">${fmtMs(ev.duration_ms)}</span>` : ""}
      </div>
      ${renderEventBody(ev)}
    </li>
  `;
}

async function load() {
  const trace_id = getTraceId();
  if (!trace_id) return;
  const r = await fetch(`/api/requests/${encodeURIComponent(trace_id)}`);
  if (!r.ok) {
    document.getElementById("header").innerHTML = `<p class="text-rose-400">Request not found</p>`;
    return;
  }
  const data = await r.json();
  document.getElementById("header").innerHTML = renderHeader(data.request);
  const events = data.events || [];
  document.getElementById("timeline").innerHTML =
    events.map(renderEvent).join("") ||
    `<li class="text-slate-500 text-sm">No events recorded.</li>`;
}

load();
