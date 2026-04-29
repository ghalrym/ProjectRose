// ProjectRose · Extensions catalog page
// Lists all known extensions (those in the registry) with links to their individual repos.

const { useState, useEffect } = React;

// ─── shared layout primitives (mirrors site.jsx) ───
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
        marginTop: 18, maxWidth: 720, fontFamily: H.mono, fontSize: 14,
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

// ─── nav (active page = EXTENSIONS) ───
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
            { n: '04', l: 'EXTENSIONS', href: 'extensions.html', active: true },
            { n: '05', l: 'INSTALL',    href: 'index.html#install' },
            { n: '06', l: 'DOCS',       href: 'docs.html' },
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
// CATALOG — every known extension (those in the registry), with its own repo link
// ═════════════════════════════════════════════════════════════
const EXTENSIONS = [
  {
    n: '01',
    id: 'rose-crm',
    name: 'CRM',
    latin: 'Rosa hominum',
    description: 'Contact management — store and retrieve people and places for the AI agent.',
    tag: 'KNOWLEDGE',
    repo: 'https://github.com/RoseAgent/projectrose-crm',
  },
  {
    n: '02',
    id: 'rose-discord',
    name: 'Discord',
    latin: 'Rosa colloquii',
    description: 'Read and write Discord channels, DMs, and threads — with a native panel inside the IDE.',
    tag: 'COMM',
    repo: 'https://github.com/RoseAgent/projectrose-discord',
  },
  {
    n: '03',
    id: 'rose-docker',
    name: 'Docker',
    latin: 'Rosa thecaria',
    description: 'Inspect and control containers without leaving the editor — logs, files, exec.',
    tag: 'INFRA',
    repo: 'https://github.com/RoseAgent/projectrose-docker',
  },
  {
    n: '04',
    id: 'rose-email',
    name: 'Email',
    latin: 'Rosa epistolaris',
    description: 'IMAP email management with spam filtering and prompt-injection quarantine.',
    tag: 'COMM',
    repo: 'https://github.com/RoseAgent/projectrose-email',
  },
  {
    n: '05',
    id: 'rose-git',
    name: 'Git',
    latin: 'Rosa propaginis',
    description: 'Git repository management with diff viewer and staging area.',
    tag: 'DEV',
    repo: 'https://github.com/RoseAgent/projectrose-git',
  },
  {
    n: '06',
    id: 'rose-heartbeat',
    name: 'Heartbeat',
    latin: 'Rosa pulsus',
    description: 'Automatically processes deferred tasks and scheduled work on a configurable interval.',
    tag: 'AUTOMATION',
    repo: 'https://github.com/RoseAgent/projectrose-heartbeat',
  },
];

function CatalogHero() {
  return (
    <section style={{ background: H.paper, padding: '60px 40px 28px' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          marginBottom: 32, paddingBottom: 8, borderBottom: `1px solid ${H.line}`,
        }}>
          <div style={{
            fontFamily: H.mono, fontSize: 10, color: H.inkSoft, letterSpacing: 2.4,
          }}>
            FOLIO 05 · CATALOG OF EXTENSIONS
          </div>
          <div style={{
            fontFamily: H.mono, fontSize: 10, color: H.inkSoft, letterSpacing: 1.6, fontStyle: 'italic',
          }}>
            {EXTENSIONS.length} cultivars · open source · MIT
          </div>
        </div>
        <div style={{ borderBottom: `1px solid ${H.lineSoft}`, marginBottom: 36, marginTop: 2 }}/>

        <div style={{
          fontFamily: H.mono, fontSize: 11, color: H.sepia, letterSpacing: 2.4, marginBottom: 16,
          fontWeight: 500,
        }}>
          ☞ THE AGENT&apos;S VOCABULARY OF ACTION
        </div>

        <h1 style={{
          fontFamily: H.mono, fontSize: 52, fontWeight: 400,
          color: H.ink, letterSpacing: -1, lineHeight: 1.05, margin: 0, maxWidth: 880,
        }}>
          Every{' '}
          <span style={{ fontStyle: 'italic', color: H.sepia, fontWeight: 500 }}>extension</span>
          {' '}lives in its own repo.
        </h1>

        <p style={{
          marginTop: 24, maxWidth: 720,
          fontFamily: H.mono, fontSize: 14, lineHeight: 1.7, color: H.inkMid,
        }}>
          Extensions ship a set of tools — and, if they like, a UI panel — that the agent
          can call directly. Every known extension below is open source, MIT-licensed,
          and maintained in its own repository. Browse the catalog, or install from
          inside ProjectRose under <i style={{ color: H.ink }}>Settings → Extensions</i>.
        </p>
      </div>
    </section>
  );
}

function CatalogGrid() {
  return (
    <section style={{
      background: H.vellum, padding: '64px 40px',
      borderTop: `1px solid ${H.line}`, borderBottom: `1px solid ${H.line}`,
    }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <PlateLabel
          n="V"
          title="KNOWN EXTENSIONS"
          right="EACH WITH ITS OWN REPOSITORY"
        />

        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18,
        }}>
          {EXTENSIONS.map((e) => (
            <div key={e.id} style={{
              background: H.paperLight, border: `1px solid ${H.line}`,
              padding: '22px 24px', position: 'relative',
              minHeight: 240, display: 'flex', flexDirection: 'column',
              boxShadow: H.shadow,
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                <span style={{
                  fontFamily: H.mono, fontSize: 9, color: H.sepia, letterSpacing: 1.4,
                  fontWeight: 600,
                }}>№{e.n}</span>
                <span style={{
                  fontFamily: H.mono, fontSize: 16, color: H.ink, fontWeight: 500,
                }}>{e.name}</span>
                <div style={{ flex: 1 }}/>
                <Tag color={H.olive}>{e.tag}</Tag>
              </div>

              <div style={{
                fontFamily: H.mono, fontSize: 10, color: H.sepia,
                fontStyle: 'italic', letterSpacing: 0.4, marginBottom: 12,
              }}>{e.latin}</div>

              <div style={{
                fontFamily: H.mono, fontSize: 12, color: H.inkMid, lineHeight: 1.65,
                flex: 1,
              }}>{e.description}</div>

              <div style={{
                marginTop: 16, paddingTop: 12, borderTop: `1px solid ${H.lineSoft}`,
                fontFamily: H.mono, fontSize: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
              }}>
                <span style={{ color: H.inkSoft, fontStyle: 'italic' }}>
                  {e.id}
                </span>
                <a
                  href={e.repo}
                  target="_blank" rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '5px 10px', textDecoration: 'none',
                    color: H.paperLight, background: H.ink,
                    fontFamily: H.mono, fontSize: 10, fontWeight: 500, letterSpacing: 1.2,
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
                  <span>VIEW REPO ↗</span>
                </a>
              </div>
            </div>
          ))}
        </div>

        {/* Build-your-own callout */}
        <div style={{
          marginTop: 48, background: H.ink, color: H.paperLight,
          padding: '32px 36px',
          display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 36, alignItems: 'center',
        }}>
          <div>
            <div style={{
              fontFamily: H.mono, fontSize: 10, color: H.ochreSoft, letterSpacing: 2,
              marginBottom: 10, fontWeight: 500,
            }}>BUILD YOUR OWN</div>
            <div style={{
              fontFamily: H.mono, fontSize: 22, fontWeight: 500, lineHeight: 1.3, marginBottom: 10,
              letterSpacing: -0.2,
            }}>
              Got a tool you wish the agent could reach?
            </div>
            <p style={{
              fontFamily: H.mono, fontSize: 12, color: '#cebca0', lineHeight: 1.7, margin: 0,
              maxWidth: 480,
            }}>
              An extension is a <code style={{ color: H.ochreSoft }}>rose-extension.json</code> manifest, a renderer bundle, and an
              optional main-process bundle. Publish to GitHub, open a PR against
              <code style={{ color: H.ochreSoft }}> extensions/registry.json</code>, and it shows up in
              every ProjectRose installation&apos;s in-app store.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <a
              href="https://github.com/RoseAgent/ProjectRose#extensions"
              target="_blank" rel="noopener noreferrer"
              style={{
                padding: '12px 16px', textDecoration: 'none',
                background: H.sepia, color: H.paperLight,
                fontFamily: H.mono, fontSize: 11, fontWeight: 500, letterSpacing: 1.2,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}
            >
              <span>READ THE EXTENSION GUIDE</span>
              <span>↗</span>
            </a>
            <a
              href="https://github.com/RoseAgent/ProjectRose/blob/master/extensions/registry.json"
              target="_blank" rel="noopener noreferrer"
              style={{
                padding: '12px 16px', textDecoration: 'none',
                background: 'transparent', color: H.paperLight,
                border: '1px solid #3a2e22',
                fontFamily: H.mono, fontSize: 11, fontWeight: 500, letterSpacing: 1.2,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}
            >
              <span>BROWSE REGISTRY.JSON</span>
              <span style={{ color: H.ochreSoft }}>↗</span>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

// ═════════════════════════════════════════════════════════════
// FOOTER · COLOPHON (slim version)
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
      <CatalogHero />
      <CatalogGrid />
      <Colophon />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Page />);
