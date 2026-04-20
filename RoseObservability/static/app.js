const fmtDate = (iso) => {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

const fmtMs = (ms) => {
  if (ms == null) return "–";
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

const esc = (s) => {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
};

const summaryText = (item) => {
  const s = item.summary || {};
  if (item.service === "roselibrary") {
    const q = (s.query && s.query.query) || "";
    const rs = s.response_summary || {};
    const rc = rs.results_count != null ? ` · ${rs.results_count} results` : "";
    return esc(q.slice(0, 90)) + esc(rc);
  }
  return "";
};

async function loadTiles() {
  try {
    const r = await fetch("/api/metrics/summary?window_minutes=60");
    const data = await r.json();
    const rl = data.roselibrary || {};
    document.querySelector('[data-tile="total"]').textContent = rl.count || 0;
    document.querySelector('[data-tile="rl_avg"]').textContent = fmtMs(rl.avg_duration_ms);
    document.querySelector('[data-tile="errors"]').textContent = rl.error_count || 0;
  } catch (e) {
    console.error(e);
  }
}

async function loadRows() {
  const service = document.getElementById("filter-service").value;
  const qs = new URLSearchParams({ limit: "50" });
  if (service) qs.set("service", service);
  try {
    const r = await fetch(`/api/requests?${qs}`);
    const data = await r.json();
    const rows = (data.items || []).map((item) => `
      <tr class="border-b border-slate-800 hover:bg-slate-800/40 cursor-pointer"
          onclick="window.location.href='/request/${encodeURIComponent(item.trace_id)}'">
        <td class="px-4 py-2 text-slate-400">${fmtDate(item.started_at)}</td>
        <td class="px-4 py-2"><span class="badge badge-${item.service}">${item.service}</span></td>
        <td class="px-4 py-2 font-mono text-xs">${esc(item.endpoint)}</td>
        <td class="px-4 py-2 text-right">${fmtMs(item.duration_ms)}</td>
        <td class="px-4 py-2"><span class="badge badge-${item.status}">${esc(item.status)}</span></td>
        <td class="px-4 py-2 text-slate-300">${summaryText(item)}</td>
      </tr>`).join("");
    document.getElementById("rows").innerHTML =
      rows || `<tr><td colspan="6" class="px-4 py-6 text-center text-slate-500">No requests yet</td></tr>`;
  } catch (e) {
    console.error(e);
  }
}

function refreshAll() {
  loadTiles();
  loadRows();
}

document.getElementById("filter-service").addEventListener("change", loadRows);
document.getElementById("refresh").addEventListener("click", refreshAll);

refreshAll();
setInterval(refreshAll, 5000);
