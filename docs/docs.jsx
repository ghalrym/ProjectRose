// ProjectRose · Documentation page
// How the app works + a step-by-step extension tutorial.

const { useState, useEffect } = React;

// ─── shared layout primitives ───
const PlateLabel = ({ n, title, sub, right }) => (
  <div style={{ marginBottom: 24 }}>
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      paddingBottom: 6, borderBottom: `1px solid ${H.line}`,
    }}>
      <div style={{
        fontFamily: H.mono, fontSize: 10, color: H.inkSoft, letterSpacing: 2.4,
      }}>
        PLATE {n} · {title}
      </div>
      {right && (
        <div style={{
          fontFamily: H.mono, fontSize: 10, color: H.inkSoft,
          letterSpacing: 1.4, fontStyle: 'italic',
        }}>{right}</div>
      )}
    </div>
    <div style={{ borderBottom: `1px solid ${H.lineSoft}`, marginTop: 2 }}/>
    {sub && (
      <div style={{
        marginTop: 18, maxWidth: 760, fontFamily: H.mono, fontSize: 14,
        color: H.inkMid, lineHeight: 1.65, fontStyle: 'italic',
      }}>{sub}</div>
    )}
  </div>
);

const Tag = ({ children, color = H.sepia, bg = 'transparent' }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 6,
    fontFamily: H.mono, fontSize: 9, color, letterSpacing: 1.6,
    border: `1px solid ${color}`, padding: '3px 8px',
    background: bg,
  }}>{children}</span>
);

// Inline code style
const Code = ({ children }) => (
  <code style={{
    fontFamily: H.mono, fontSize: 12, color: H.ink,
    background: H.paperDeep, padding: '1px 6px',
    border: `1px solid ${H.lineSoft}`,
  }}>{children}</code>
);

// Code block — terminal-styled
function CodeBlock({ lang, lines, title }) {
  return (
    <div style={{
      background: H.ink, color: H.paperLight,
      fontFamily: H.mono, boxShadow: H.shadow,
      marginTop: 14, marginBottom: 14,
    }}>
      <div style={{
        padding: '8px 14px', borderBottom: `1px solid #3a2e22`,
        background: '#1f1810',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#e76d67' }}/>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#e4b24d' }}/>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#7fb372' }}/>
        </div>
        <span style={{ fontSize: 10, color: '#a89a82', letterSpacing: 1.2 }}>
          {title || lang}
        </span>
        <span style={{ fontSize: 9, color: H.ochreSoft, letterSpacing: 1.6 }}>
          {lang}
        </span>
      </div>
      <pre style={{
        margin: 0, padding: '16px 18px',
        fontSize: 12, lineHeight: 1.7, color: H.paperLight,
        overflow: 'auto', whiteSpace: 'pre',
      }}>{lines}</pre>
    </div>
  );
}

// ─── nav (active page = DOCS) ───
function NavBar() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 50,
      background: H.paper,
      borderBottom: `1px solid ${H.line}`,
      backdropFilter: 'blur(6px)',
    }}>
      <div style={{
        position: 'absolute', bottom: -3, left: 0, right: 0, height: 1, background: H.lineSoft,
      }}/>
      <div style={{
        maxWidth: 1280, margin: '0 auto',
        padding: '14px 40px',
        display: 'flex', alignItems: 'center', gap: 24,
      }}>
        <a href="index.html" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          <RoseMark size={28} />
          <div style={{ lineHeight: 1.1 }}>
            <div style={{
              fontFamily: H.mono, fontSize: 14, fontWeight: 500, color: H.ink, letterSpacing: 0.2,
            }}>
              Project<span style={{ color: H.sepia, fontStyle: 'italic' }}>Rose</span>
            </div>
            <div style={{
              fontFamily: H.mono, fontSize: 9, color: H.inkSoft, letterSpacing: 1.4, marginTop: 2,
            }}>HERBARIUM · № 01</div>
          </div>
        </a>

        <div style={{ width: 1, height: 26, background: H.line, marginLeft: 4 }}/>

        <nav style={{ display: 'flex', gap: 4, fontFamily: H.mono, fontSize: 11 }}>
          {[
            { n: '01', l: 'OVERVIEW',   href: 'index.html#overview' },
            { n: '02', l: 'EDITOR',     href: 'index.html#editor' },
            { n: '03', l: 'AGENT',      href: 'index.html#agent' },
            { n: '04', l: 'EXTENSIONS', href: 'extensions.html' },
            { n: '05', l: 'INSTALL',    href: 'index.html#install' },
            { n: '06', l: 'DOCS',       href: 'docs.html', active: true },
          ].map((i) => (
            <a key={i.n} href={i.href} style={{
              padding: '6px 10px', textDecoration: 'none',
              color: i.active ? H.ink : H.inkMid, letterSpacing: 1, display: 'flex', gap: 6, alignItems: 'center',
              border: `1px solid ${i.active ? H.line : 'transparent'}`,
              background: i.active ? H.paperLight : 'transparent',
              transition: 'all .15s',
            }}
              onMouseEnter={(e) => { if (!i.active) { e.currentTarget.style.borderColor = H.line; e.currentTarget.style.color = H.ink; } }}
              onMouseLeave={(e) => { if (!i.active) { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.color = H.inkMid; } }}
            >
              <span style={{ color: i.active ? H.sepia : H.inkSoft, fontSize: 9 }}>№{i.n}</span>
              <span>{i.l}</span>
            </a>
          ))}
        </nav>

        <div style={{ flex: 1 }}/>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: H.olive }}/>
            <span style={{ fontFamily: H.mono, fontSize: 10, color: H.inkSoft, letterSpacing: 1.2 }}>
              CATALOGED
            </span>
          </div>
          <a
            href="https://github.com/RoseAgent/ProjectRose"
            target="_blank" rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 12px', textDecoration: 'none',
              fontFamily: H.mono, fontSize: 10, fontWeight: 500, letterSpacing: 1.2,
              color: H.paperLight, background: H.ink,
              border: `1px solid ${H.ink}`,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
            <span>GITHUB</span>
          </a>
          <button
            onClick={() => setDark((v) => !v)}
            title={dark ? 'Switch to paper' : 'Switch to dusk'}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 12px', cursor: 'pointer',
              fontFamily: H.mono, fontSize: 10, fontWeight: 500, letterSpacing: 1.4,
              color: H.ink, background: 'transparent',
              border: `1px solid ${H.line}`,
            }}
          >
            <span style={{ fontSize: 11 }}>{dark ? '☾' : '☀'}</span>
            <span>{dark ? 'DUSK' : 'PAPER'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// HERO
// ═════════════════════════════════════════════════════════════
function DocsHero() {
  return (
    <section style={{ background: H.paper, padding: '56px 40px 24px' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          marginBottom: 32, paddingBottom: 8, borderBottom: `1px solid ${H.line}`,
        }}>
          <div style={{
            fontFamily: H.mono, fontSize: 10, color: H.inkSoft, letterSpacing: 2.4,
          }}>
            FOLIO 06 · DOCUMENTATION &amp; FIELD GUIDE
          </div>
          <div style={{
            fontFamily: H.mono, fontSize: 10, color: H.inkSoft, letterSpacing: 1.6, fontStyle: 'italic',
          }}>
            architecture · APIs · extension tutorial
          </div>
        </div>
        <div style={{ borderBottom: `1px solid ${H.lineSoft}`, marginBottom: 32, marginTop: 2 }}/>

        <div style={{
          fontFamily: H.mono, fontSize: 11, color: H.sepia, letterSpacing: 2.4, marginBottom: 16,
          fontWeight: 500,
        }}>
          ☞ HOW PROJECTROSE WORKS
        </div>

        <h1 style={{
          fontFamily: H.mono, fontSize: 52, fontWeight: 400,
          color: H.ink, letterSpacing: -1, lineHeight: 1.05, margin: 0, maxWidth: 920,
        }}>
          The <span style={{ fontStyle: 'italic', color: H.sepia, fontWeight: 500 }}>field guide</span>{' '}
          to the editor, the agent, and the extension API.
        </h1>

        <p style={{
          marginTop: 24, maxWidth: 760,
          fontFamily: H.mono, fontSize: 14, lineHeight: 1.7, color: H.inkMid,
        }}>
          Everything below is what you need to operate ProjectRose, understand what
          its moving parts do, and write your own extension. Skim the architecture
          section first — most of the code you&apos;ll write later assumes that mental model.
        </p>

        {/* TOC strip */}
        <div style={{
          marginTop: 36, padding: '16px 22px',
          background: H.paperLight, border: `1px solid ${H.line}`,
          display: 'flex', flexWrap: 'wrap', gap: 22, alignItems: 'center',
        }}>
          <span style={{
            fontFamily: H.mono, fontSize: 9, color: H.inkSoft, letterSpacing: 1.6,
          }}>ON THIS PAGE</span>
          <span style={{ width: 1, height: 16, background: H.line }}/>
          {[
            { l: 'Architecture',          href: '#architecture' },
            { l: 'The editor',             href: '#docs-editor' },
            { l: 'The agent runtime',      href: '#docs-agent' },
            { l: 'Settings &amp; projects', href: '#docs-settings' },
            { l: 'Build an extension',     href: '#tutorial' },
            { l: 'Publishing',             href: '#publishing' },
          ].map((i) => (
            <a key={i.l} href={i.href} style={{
              fontFamily: H.mono, fontSize: 11, color: H.ink, textDecoration: 'none',
              borderBottom: `1px dotted ${H.lineStrong}`,
            }} dangerouslySetInnerHTML={{ __html: i.l }}/>
          ))}
        </div>
      </div>
    </section>
  );
}

// ═════════════════════════════════════════════════════════════
// ARCHITECTURE
// ═════════════════════════════════════════════════════════════
function ArchitectureSection() {
  return (
    <section id="architecture" style={{
      background: H.vellum, padding: '72px 40px',
      borderTop: `1px solid ${H.line}`, borderBottom: `1px solid ${H.line}`,
    }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <PlateLabel
          n="I"
          title="ARCHITECTURE"
          right="WHAT TALKS TO WHAT"
          sub={<>
            ProjectRose is an Electron app — a single binary with two distinct
            JavaScript worlds. Most of what you build as an extension lives in
            both, with a thin <i style={{ color: H.sepia }}>context object</i> bridging them.
          </>}
        />

        <div style={{
          display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 36, alignItems: 'flex-start',
        }}>
          {/* diagram */}
          <div style={{
            background: H.paperLight, border: `1px solid ${H.line}`,
            padding: '28px 30px', boxShadow: H.shadow,
          }}>
            <div style={{
              fontFamily: H.mono, fontSize: 9, color: H.inkSoft, letterSpacing: 1.6,
              marginBottom: 18,
            }}>FIG. 01 · PROCESS MODEL</div>

            {/* simple ascii-style boxes */}
            <pre style={{
              margin: 0, fontFamily: H.mono, fontSize: 12, color: H.ink, lineHeight: 1.7,
              whiteSpace: 'pre-wrap',
            }}>{`┌────────────────────────── RENDERER (browser) ──────────────────────────┐
│                                                                        │
│   Monaco editor   ·   Agent chat panel   ·   Extension UI views        │
│                                                                        │
│   React + Zustand · talks to main via preload IPC                      │
└────────────────────────────────┬───────────────────────────────────────┘
                                 │
                          preload bridge (IPC)
                                 │
┌────────────────────────────────┴───────────────────────────────────────┐
│                              MAIN (Node.js)                            │
│                                                                        │
│   File I/O · Terminal (PTY) · Git · LSP · LLM provider clients         │
│   Extension main-process bundles (tools, services)                     │
└────────────────────────────────────────────────────────────────────────┘`}</pre>

            <div style={{
              marginTop: 22, paddingTop: 16, borderTop: `1px solid ${H.lineSoft}`,
              fontFamily: H.mono, fontSize: 11, color: H.inkMid, lineHeight: 1.7,
            }}>
              The agent loop runs in the renderer using the{' '}
              <Code>ai</Code> SDK. When the model decides to call a tool, the
              renderer dispatches an IPC message; the matching extension main bundle
              executes it (network calls, file edits, container exec — anything Node
              can do) and returns a string result the agent reads next turn.
            </div>
          </div>

          {/* concepts */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[
              {
                t: 'Renderer',
                d: 'A Vite-built React app. Hosts Monaco, the chat panel, and any UI panels extensions register.',
              },
              {
                t: 'Main process',
                d: 'Owns Node — filesystem, child processes, network. Extensions register tools and IPC handlers here.',
              },
              {
                t: 'Provider',
                d: 'A pluggable LLM backend — Ollama (local), Anthropic, OpenAI, or Bedrock. Selected per project.',
              },
              {
                t: 'Project',
                d: 'A directory ProjectRose treats as a workspace. Settings, sessions, and extension configs are scoped to it under .projectrose/.',
              },
              {
                t: 'Extension',
                d: 'A bundle that adds tools (for the agent), UI views (for you), or both. Each lives in its own repo.',
              },
            ].map((c) => (
              <div key={c.t} style={{
                background: H.paperLight, border: `1px solid ${H.line}`,
                padding: '14px 18px',
              }}>
                <div style={{
                  fontFamily: H.mono, fontSize: 13, color: H.ink, fontWeight: 500, marginBottom: 4,
                }}>{c.t}</div>
                <div style={{
                  fontFamily: H.mono, fontSize: 11, color: H.inkMid, lineHeight: 1.6,
                }}>{c.d}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ═════════════════════════════════════════════════════════════
// EDITOR / AGENT / SETTINGS — three concise reference sections
// ═════════════════════════════════════════════════════════════
function ReferenceSections() {
  return (
    <section style={{ background: H.paper, padding: '72px 40px' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>

        {/* EDITOR */}
        <div id="docs-editor" style={{ marginBottom: 56 }}>
          <PlateLabel
            n="II"
            title="THE EDITOR"
            right="MONACO · TERMINAL · LSP"
            sub={<>What ships out of the box, and the keyboard shortcuts that matter.</>}
          />
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16,
          }}>
            {[
              { k: 'File tree',     d: <>Browse the project root in the left rail. Right-click for new file, rename, reveal in OS, and Git actions.</> },
              { k: 'Tabs',          d: <>Multi-file tabbed editing. Tabs persist across restarts per project under <Code>.projectrose/sessions.json</Code>.</> },
              { k: 'Quick open',    d: <><Code>Ctrl/⌘ + P</Code> opens a fuzzy file finder.</> },
              { k: 'Command palette', d: <><Code>Ctrl/⌘ + Shift + P</Code> exposes editor + extension commands.</> },
              { k: 'Terminal',      d: <>Full PTY. Multiple sessions per project. Open with <Code>Ctrl/⌘ + `</Code>.</> },
              { k: 'Language servers', d: <>TypeScript (<Code>tsserver</Code>) and Python (<Code>Pyright</Code>) over LSP. Autostart on file open.</> },
            ].map((r) => (
              <div key={r.k} style={{
                background: H.paperLight, border: `1px solid ${H.line}`,
                padding: '14px 18px',
              }}>
                <div style={{
                  fontFamily: H.mono, fontSize: 13, color: H.ink, fontWeight: 500, marginBottom: 4,
                }}>{r.k}</div>
                <div style={{
                  fontFamily: H.mono, fontSize: 11, color: H.inkMid, lineHeight: 1.7,
                }}>{r.d}</div>
              </div>
            ))}
          </div>
        </div>

        {/* AGENT */}
        <div id="docs-agent" style={{ marginBottom: 56 }}>
          <PlateLabel
            n="III"
            title="THE AGENT RUNTIME"
            right="TOOL-USE · STREAMING"
            sub={<>
              The agent panel is a normal chat with a tool-use loop. The model
              streams a reply; if it calls a tool, the renderer dispatches it,
              streams the result back, and loops until the model emits a final
              answer.
            </>}
          />
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16,
          }}>
            <div style={{
              background: H.paperLight, border: `1px solid ${H.line}`,
              padding: '18px 22px',
            }}>
              <div style={{
                fontFamily: H.mono, fontSize: 13, color: H.ink, fontWeight: 500, marginBottom: 8,
              }}>System prompt</div>
              <p style={{ fontFamily: H.mono, fontSize: 11, color: H.inkMid, lineHeight: 1.7, margin: 0 }}>
                Edit per project under <i>Settings → Agent → System prompt</i>. Stored in{' '}
                <Code>.projectrose/agent.json</Code>. Variables like <Code>{'{{projectRoot}}'}</Code> and{' '}
                <Code>{'{{date}}'}</Code> are interpolated at send time.
              </p>
            </div>
            <div style={{
              background: H.paperLight, border: `1px solid ${H.line}`,
              padding: '18px 22px',
            }}>
              <div style={{
                fontFamily: H.mono, fontSize: 13, color: H.ink, fontWeight: 500, marginBottom: 8,
              }}>Sessions</div>
              <p style={{ fontFamily: H.mono, fontSize: 11, color: H.inkMid, lineHeight: 1.7, margin: 0 }}>
                Every conversation is a session, stored as JSON. Switch tabs in the
                chat header. Sessions can be exported as a transcript for review.
              </p>
            </div>
            <div style={{
              background: H.paperLight, border: `1px solid ${H.line}`,
              padding: '18px 22px',
            }}>
              <div style={{
                fontFamily: H.mono, fontSize: 13, color: H.ink, fontWeight: 500, marginBottom: 8,
              }}>Tool calls</div>
              <p style={{ fontFamily: H.mono, fontSize: 11, color: H.inkMid, lineHeight: 1.7, margin: 0 }}>
                Built-in tools cover file I/O, shell, and Git. Extensions add more.
                Each tool call is logged inline in the transcript with input + result.
              </p>
            </div>
            <div style={{
              background: H.paperLight, border: `1px solid ${H.line}`,
              padding: '18px 22px',
            }}>
              <div style={{
                fontFamily: H.mono, fontSize: 13, color: H.ink, fontWeight: 500, marginBottom: 8,
              }}>Providers</div>
              <p style={{ fontFamily: H.mono, fontSize: 11, color: H.inkMid, lineHeight: 1.7, margin: 0 }}>
                Configure under <i>Settings → Providers</i>. Ollama needs only a base
                URL (defaults to <Code>http://localhost:11434</Code>); cloud providers
                need an API key. The first provider you set up becomes the default.
              </p>
            </div>
          </div>
        </div>

        {/* SETTINGS */}
        <div id="docs-settings">
          <PlateLabel
            n="IV"
            title="SETTINGS &amp; PROJECTS"
            right="GLOBAL · PROJECT · EXTENSION"
            sub={<>
              Three layers of settings, each scoped narrower than the last.
            </>}
          />
          <div style={{
            background: H.paperLight, border: `1px solid ${H.line}`,
            padding: '20px 24px',
          }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '160px 1fr', gap: 14,
              fontFamily: H.mono, fontSize: 12,
            }}>
              {[
                { k: 'Global',  v: <>Lives in your OS user data dir. Provider keys, default model, theme.</> },
                { k: 'Project', v: <>Lives in <Code>.projectrose/settings.json</Code>. Per-project overrides, system prompt, enabled extensions.</> },
                { k: 'Extension', v: <>Each extension owns its slice under <Code>settings.extensions[&apos;rose-&lt;name&gt;&apos;]</Code> in both files.</> },
              ].map((r) => (
                <React.Fragment key={r.k}>
                  <span style={{ color: H.sepia, fontStyle: 'italic', letterSpacing: 0.4 }}>{r.k}</span>
                  <span style={{ color: H.inkMid, lineHeight: 1.7 }}>{r.v}</span>
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}

// ═════════════════════════════════════════════════════════════
// EXTENSION TUTORIAL — the meaty section
// ═════════════════════════════════════════════════════════════
function TutorialSection() {
  const manifest = `{
  "id": "rose-weather",
  "name": "Weather",
  "version": "0.1.0",
  "description": "Look up the current weather for a city.",
  "author": "Your Name",
  "latin": "Rosa nubium",
  "navItem": { "label": "Weather", "iconName": "cloud" },
  "provides": {
    "pageView": true,
    "globalSettings": true,
    "agentTools": true,
    "main": true,
    "tools": [
      {
        "name": "get_weather",
        "displayName": "Get Weather",
        "description": "Get the current weather for a given city."
      }
    ]
  }
}`;

  const renderer = `// renderer.ts — what the UI side of the extension exports.
// The host app loads these names from your bundle.

export { default as manifest } from './rose-extension.json'
export { WeatherView as PageView }       from './src/renderer/WeatherView'
export { WeatherSettings as SettingsView } from './src/renderer/WeatherSettings'`;

  const main = `// main.ts — what runs in the Node main process.
// 'ctx' is the bridge to the host: settings, IPC, tool registration.

import type { ExtensionMainContext } from './types'

const TOOLS = [
  {
    name: 'get_weather',
    description: 'Get the current weather for a given city.',
    schema: {
      type: 'object',
      properties: { city: { type: 'string', description: 'City name' } },
      required: ['city'],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
      const city = String(input.city ?? '')
      const r = await fetch(
        \`https://wttr.in/\${encodeURIComponent(city)}?format=j1\`
      )
      const data = await r.json()
      const cur = data.current_condition?.[0]
      return cur
        ? \`\${city}: \${cur.temp_C}°C, \${cur.weatherDesc?.[0]?.value}\`
        : \`No data for \${city}\`
    },
  },
]

export function register(ctx: ExtensionMainContext): () => void {
  ctx.registerTools(TOOLS)
  return () => { /* called when the extension is unloaded */ }
}`;

  const view = `// src/renderer/WeatherView.tsx — the page panel.
// Plain React. Use the host's IPC bridge to call into your main bundle.

import { useState } from 'react'

export function WeatherView() {
  const [city, setCity]       = useState('')
  const [result, setResult]   = useState('')

  async function lookup() {
    // Every extension tool is also exposed as an IPC channel.
    const r = await window.rose.invoke('rose-weather:get_weather', { city })
    setResult(r)
  }

  return (
    <div style={{ padding: 24 }}>
      <h2>Weather</h2>
      <input value={city} onChange={(e) => setCity(e.target.value)} />
      <button onClick={lookup}>Look up</button>
      <pre>{result}</pre>
    </div>
  )
}`;

  const pkg = `{
  "name": "@you/rose-weather",
  "version": "0.1.0",
  "private": true,
  "exports": {
    "./renderer": "./renderer.ts",
    "./main":     "./main.ts"
  },
  "scripts": {
    "build:renderer": "esbuild renderer.ts --bundle --format=cjs --platform=browser --jsx=automatic --outfile=dist/renderer.js --external:react --external:react/jsx-runtime --external:@renderer/* --external:zustand",
    "build:main":     "esbuild main.ts     --bundle --format=cjs --platform=node    --outfile=dist/main.js     --external:electron --external:@main/*",
    "build": "npm run build:renderer && npm run build:main"
  },
  "devDependencies": { "esbuild": "^0.21.0", "typescript": "^5.0.0" }
}`;

  const sideload = `# Build the bundle
npm install
npm run build

# Sideload locally:
#   ProjectRose → Settings → Extensions → "Load from folder…"
# Pick the directory containing rose-extension.json.
# The extension shows up in the left rail immediately.`;

  const steps = [
    {
      n: '01',
      t: 'Scaffold the directory',
      body: (
        <>
          <p style={{ fontFamily: H.mono, fontSize: 12, color: H.inkMid, lineHeight: 1.7 }}>
            An extension is a folder with a manifest, two entry files, and a build
            output. Anywhere on disk works while you&apos;re developing — it does
            not have to live inside the ProjectRose tree.
          </p>
          <CodeBlock lang="text" lines={`rose-weather/
├── rose-extension.json    ← manifest
├── package.json           ← build scripts
├── renderer.ts            ← UI entry
├── main.ts                ← Node entry
├── src/
│   └── renderer/
│       ├── WeatherView.tsx
│       └── WeatherSettings.tsx
└── dist/                  ← built bundles (generated)`} />
        </>
      ),
    },
    {
      n: '02',
      t: 'Write the manifest',
      body: (
        <>
          <p style={{ fontFamily: H.mono, fontSize: 12, color: H.inkMid, lineHeight: 1.7 }}>
            <Code>rose-extension.json</Code> tells ProjectRose what your extension
            offers. <Code>provides</Code> declares which capabilities are present
            so the host knows what bundles to load.
          </p>
          <CodeBlock lang="json" title="rose-extension.json" lines={manifest}/>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10,
            fontFamily: H.mono, fontSize: 11, color: H.inkMid,
          }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ color: H.sepia, minWidth: 90, fontStyle: 'italic' }}>pageView</span>
              <span>renders a full-page panel in the left nav</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ color: H.sepia, minWidth: 90, fontStyle: 'italic' }}>globalSettings</span>
              <span>adds a tab under Settings → Extensions</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ color: H.sepia, minWidth: 90, fontStyle: 'italic' }}>agentTools</span>
              <span>tools listed here are advertised to the LLM</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ color: H.sepia, minWidth: 90, fontStyle: 'italic' }}>main</span>
              <span>load a Node-side bundle (needed for tools)</span>
            </div>
          </div>
        </>
      ),
    },
    {
      n: '03',
      t: 'Wire the renderer entry',
      body: (
        <>
          <p style={{ fontFamily: H.mono, fontSize: 12, color: H.inkMid, lineHeight: 1.7 }}>
            <Code>renderer.ts</Code> is what the host imports from your bundle in
            the renderer process. Re-export the manifest and any view components
            it should mount. <Code>PageView</Code> and <Code>SettingsView</Code>{' '}
            are the names the host looks up.
          </p>
          <CodeBlock lang="ts" title="renderer.ts" lines={renderer}/>
          <CodeBlock lang="tsx" title="src/renderer/WeatherView.tsx" lines={view}/>
        </>
      ),
    },
    {
      n: '04',
      t: 'Wire the main entry',
      body: (
        <>
          <p style={{ fontFamily: H.mono, fontSize: 12, color: H.inkMid, lineHeight: 1.7 }}>
            <Code>main.ts</Code> exports a single <Code>register(ctx)</Code>{' '}
            function. The <Code>ctx</Code> is your interface to the host: it lets
            you read/write settings, broadcast IPC events, and register the tools
            the agent will call. Return a cleanup function — it runs on unload.
          </p>
          <CodeBlock lang="ts" title="main.ts" lines={main}/>
          <div style={{
            background: H.paperLight, border: `1px solid ${H.line}`,
            padding: '14px 18px', marginTop: 12,
            fontFamily: H.mono, fontSize: 11, color: H.inkMid, lineHeight: 1.7,
          }}>
            <strong style={{ color: H.ink }}>Tool schema → JSON Schema.</strong>{' '}
            The <Code>schema</Code> field is fed to the LLM verbatim, so it&apos;s
            worth being precise: list every property, mark <Code>required</Code>{' '}
            ones, and give each parameter a description the model can actually use.
          </div>
        </>
      ),
    },
    {
      n: '05',
      t: 'Build with esbuild',
      body: (
        <>
          <p style={{ fontFamily: H.mono, fontSize: 12, color: H.inkMid, lineHeight: 1.7 }}>
            ProjectRose loads CJS bundles from <Code>dist/</Code>. The flags below
            mark <Code>react</Code>, <Code>electron</Code>, and the host-internal{' '}
            <Code>@renderer/*</Code> / <Code>@main/*</Code> as external — those
            come from the host at runtime so your bundle stays small.
          </p>
          <CodeBlock lang="json" title="package.json" lines={pkg}/>
        </>
      ),
    },
    {
      n: '06',
      t: 'Sideload &amp; iterate',
      body: (
        <>
          <p style={{ fontFamily: H.mono, fontSize: 12, color: H.inkMid, lineHeight: 1.7 }}>
            With the manifest pointing at your built <Code>dist/</Code>, sideload
            from inside the app. Edits to your source rebuild on save (run{' '}
            <Code>npm run build -- --watch</Code>) and ProjectRose hot-reloads
            the bundle on the next render.
          </p>
          <CodeBlock lang="bash" title="terminal" lines={sideload}/>
        </>
      ),
    },
  ];

  return (
    <section id="tutorial" style={{
      background: H.vellum, padding: '88px 40px',
      borderTop: `1px solid ${H.line}`, borderBottom: `1px solid ${H.line}`,
    }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <PlateLabel
          n="V"
          title="BUILD AN EXTENSION · TUTORIAL"
          right="A WORKED EXAMPLE — rose-weather"
          sub={<>
            Six steps from empty folder to a working extension that adds a{' '}
            <Code>get_weather</Code> tool, a settings tab, and a sidebar panel.
            The full source for every first-party extension lives at{' '}
            <a href="https://github.com/RoseAgent" target="_blank" rel="noopener noreferrer"
              style={{ color: H.sepia, textDecoration: 'none', borderBottom: `1px dotted ${H.sepia}` }}>
              github.com/RoseAgent
            </a> if you want to copy a real one.
          </>}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {steps.map((s) => (
            <div key={s.n} style={{
              background: H.paperLight, border: `1px solid ${H.line}`,
              padding: '28px 32px', boxShadow: H.shadow,
            }}>
              <div style={{
                display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 14,
                paddingBottom: 12, borderBottom: `1px solid ${H.lineSoft}`,
              }}>
                <span style={{
                  fontFamily: H.mono, fontSize: 11, color: H.sepia,
                  letterSpacing: 1.6, fontWeight: 600, minWidth: 28,
                }}>№{s.n}</span>
                <span style={{
                  fontFamily: H.mono, fontSize: 18, color: H.ink, fontWeight: 500,
                }} dangerouslySetInnerHTML={{ __html: s.t }}/>
              </div>
              {s.body}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ═════════════════════════════════════════════════════════════
// PUBLISHING
// ═════════════════════════════════════════════════════════════
function PublishingSection() {
  return (
    <section id="publishing" style={{ background: H.paper, padding: '72px 40px' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <PlateLabel
          n="VI"
          title="PUBLISHING"
          right="GETTING YOUR EXTENSION INTO OTHER INSTALLS"
          sub={<>
            The in-app store reads <Code>extensions/registry.json</Code> from this
            repo on every launch. Submit your extension by opening a PR.
          </>}
        />

        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24,
        }}>
          {[
            {
              n: 'i',
              t: 'Tag a GitHub release',
              d: <>Push your repo to GitHub. Tag a release (e.g. <Code>v0.1.0</Code>) with the contents of <Code>dist/</Code> and <Code>rose-extension.json</Code> attached as a zip. The store downloads this zip on install.</>,
            },
            {
              n: 'ii',
              t: 'Open a registry PR',
              d: <>Add an entry to <Code>extensions/registry.json</Code> in this repo with your extension <Code>id</Code>, name, description, and <Code>repoUrl</Code>. Once merged, anyone running ProjectRose sees it under <i>Settings → Extensions → Browse</i>.</>,
            },
            {
              n: 'iii',
              t: 'Versioning',
              d: <>The store checks the latest release tag against the installed version. Bump <Code>version</Code> in the manifest and tag a new release; users get an &quot;Update&quot; button.</>,
            },
            {
              n: 'iv',
              t: 'Settings &amp; secrets',
              d: <>Never commit secrets to the manifest. Define settings fields with <Code>type: &quot;password&quot;</Code> in the global settings schema and store them via <Code>ctx.updateSettings()</Code>; the host encrypts them per-machine.</>,
            },
          ].map((r) => (
            <div key={r.n} style={{
              background: H.paperLight, border: `1px solid ${H.line}`,
              padding: '20px 24px',
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
                <span style={{
                  fontFamily: H.mono, fontSize: 11, color: H.sepia, fontStyle: 'italic',
                  letterSpacing: 0.5, fontWeight: 500, minWidth: 18,
                }}>{r.n}.</span>
                <span style={{
                  fontFamily: H.mono, fontSize: 15, color: H.ink, fontWeight: 500,
                }} dangerouslySetInnerHTML={{ __html: r.t }}/>
              </div>
              <div style={{
                marginLeft: 30, fontFamily: H.mono, fontSize: 12, color: H.inkMid, lineHeight: 1.7,
              }}>{r.d}</div>
            </div>
          ))}
        </div>

        <div style={{
          marginTop: 36, padding: '24px 28px',
          background: H.ink, color: H.paperLight,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16,
        }}>
          <div>
            <div style={{
              fontFamily: H.mono, fontSize: 9, color: H.ochreSoft, letterSpacing: 1.6, marginBottom: 6,
            }}>READY TO SHIP?</div>
            <div style={{
              fontFamily: H.mono, fontSize: 16, fontWeight: 500, letterSpacing: -0.2,
            }}>
              Open a PR against <span style={{ color: H.ochreSoft }}>extensions/registry.json</span>.
            </div>
          </div>
          <a
            href="https://github.com/RoseAgent/ProjectRose/blob/master/extensions/registry.json"
            target="_blank" rel="noopener noreferrer"
            style={{
              padding: '12px 18px', textDecoration: 'none',
              background: H.sepia, color: H.paperLight,
              fontFamily: H.mono, fontSize: 11, fontWeight: 500, letterSpacing: 1.4,
              display: 'inline-flex', alignItems: 'center', gap: 10,
            }}
          >
            <span>VIEW REGISTRY.JSON</span>
            <span>↗</span>
          </a>
        </div>
      </div>
    </section>
  );
}

// ═════════════════════════════════════════════════════════════
// FOOTER (slim)
// ═════════════════════════════════════════════════════════════
function Colophon() {
  return (
    <footer style={{
      background: H.paperDark, borderTop: `1px solid ${H.line}`,
      padding: '36px 40px 28px',
    }}>
      <div style={{
        maxWidth: 1280, margin: '0 auto',
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', flexWrap: 'wrap', gap: 16,
        fontFamily: H.mono, fontSize: 10, color: H.inkSoft, letterSpacing: 1.4,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <RoseMark size={28} />
          <span>
            Project<span style={{ color: H.sepia, fontStyle: 'italic' }}>Rose</span> · COLOPHON · set in <i>IBM Plex Mono</i>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 18 }}>
          <a href="index.html" style={{ color: H.ink, textDecoration: 'none' }}>← BACK TO OVERVIEW</a>
          <a href="extensions.html" style={{ color: H.ink, textDecoration: 'none' }}>EXTENSIONS</a>
          <a href="https://github.com/RoseAgent/ProjectRose" target="_blank" rel="noopener noreferrer" style={{ color: H.ink, textDecoration: 'none' }}>
            GITHUB ↗
          </a>
        </div>
      </div>
    </footer>
  );
}

function Page() {
  return (
    <div style={{
      background: H.paper, color: H.ink, fontFamily: H.mono, minHeight: '100vh',
    }}>
      <NavBar />
      <DocsHero />
      <ArchitectureSection />
      <ReferenceSections />
      <TutorialSection />
      <PublishingSection />
      <Colophon />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Page />);
