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

let chart = null;
let allItems = [];

function renderRows(filter) {
  const q = (filter || "").toLowerCase();
  const rows = allItems
    .filter((it) => !q || (it.query || "").toLowerCase().includes(q))
    .map((it) => `
      <tr class="border-b border-slate-800 hover:bg-slate-800/40">
        <td class="px-4 py-2 text-slate-400">${fmtTime(it.timestamp)}</td>
        <td class="px-4 py-2">${esc(it.query || "(empty)")}</td>
        <td class="px-4 py-2 text-right">${esc(it.results_count ?? "–")}</td>
        <td class="px-4 py-2 text-right">${fmtMs(it.duration_ms)}</td>
        <td class="px-4 py-2"><a class="text-rose-400 hover:underline" href="/request/${encodeURIComponent(it.trace_id)}">view</a></td>
      </tr>`).join("");
  document.getElementById("rows").innerHTML =
    rows || `<tr><td colspan="5" class="px-4 py-6 text-center text-slate-500">No searches yet</td></tr>`;
}

function renderChart(series) {
  const ctx = document.getElementById("latency-chart").getContext("2d");
  const labels = series.map((p) => new Date(p.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  const data = series.map((p) => p.duration_ms);
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "duration (ms)",
        data,
        borderColor: "#fb7185",
        backgroundColor: "rgba(251,113,133,0.15)",
        tension: 0.25,
        pointRadius: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: "#94a3b8" }, grid: { color: "#1e293b" } },
        y: { ticks: { color: "#94a3b8" }, grid: { color: "#1e293b" }, beginAtZero: true },
      },
      plugins: { legend: { labels: { color: "#cbd5e1" } } },
    },
  });
}

async function load() {
  const r = await fetch("/api/library/searches?limit=100");
  const data = await r.json();
  allItems = data.items || [];
  renderChart(data.latency_series || []);
  renderRows(document.getElementById("filter").value);
}

document.getElementById("filter").addEventListener("input", (e) => renderRows(e.target.value));

load();
setInterval(load, 10000);
