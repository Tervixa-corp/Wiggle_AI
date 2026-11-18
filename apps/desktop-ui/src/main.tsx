import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Braces,
  Check,
  CircleHelp,
  FileCode2,
  Folder,
  LayoutPanelLeft,
  MessageSquare,
  PanelRight,
  Paperclip,
  Plug,
  Plus,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { Plugins, Providers, SearchField } from "./Catalogs";
import {
  api,
  defaults,
  load,
  post,
  store,
  type Connection,
  type Preferences,
  type Skill,
} from "./state";
import "./style.css";

type Message = {
  role: "user" | "assistant" | "system";
  text: string;
  context?: string;
};
type Session = { id: string; name: string; messages: Message[] };
type Draft = {
  text: string;
  skillId: string;
  file?: { name: string; content: string };
};
const blank = (): Draft => ({ text: "", skillId: "" });
const fresh = (): Session => ({
  id: crypto.randomUUID(),
  name: "New session",
  messages: [],
});
const groups = [
  { name: "WORKBENCH", sections: ["General", "Appearance", "Shortcuts"] },
  {
    name: "AI & INTEGRATIONS",
    sections: ["Providers", "Plugins", "Instructions"],
  },
  {
    name: "WORKSPACE",
    sections: ["Privacy & history", "Permissions", "About"],
  },
];
const sections = groups.flatMap((g) => g.sections);
const readPrefs = (): Preferences => ({
  ...defaults,
  theme: localStorage.getItem("wiggle-theme") === "light" ? "light" : "dark",
  ...load("wiggle-preferences-v1", {}),
});
function Row({
  name,
  help,
  children,
}: {
  name: string;
  help: string;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{name}</strong>
        <small>{help}</small>
      </div>
      {children}
    </div>
  );
}
function Toggle({
  name,
  checked,
  onChange,
}: {
  name: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <input
      aria-label={name}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}
function App() {
  const [prefs, setPrefs] = useState(readPrefs);
  const [sessions, setSessions] = useState<Session[]>(() => {
    const saved = load<Session[]>("wiggle-sessions-v1", []);
    return prefs.saveSessions && Array.isArray(saved) && saved.length
      ? saved
      : [fresh()];
  });
  const [active, setActive] = useState(sessions[0].id);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [skills, setSkills] = useState<Skill[]>(() =>
    load("wiggle-skills-v1", []),
  );
  const [connection, setConnection] = useState<Connection | null>(null);
  const [pending, setPending] = useState<string[]>([]);
  const inFlight = useRef(new Set<string>());
  const [settings, setSettings] = useState(false);
  const [section, setSection] = useState("General");
  const [skillTab, setSkillTab] = useState(false);
  const [settingsQuery, setSettingsQuery] = useState("");
  const [sidebar, setSidebar] = useState(() => window.innerWidth > 540);
  const [right, setRight] = useState(true);
  const [sessionQuery, setSessionQuery] = useState("");
  const [fileError, setFileError] = useState("");
  const [clearConfirm, setClearConfirm] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const session = sessions.find((s) => s.id === active) ?? sessions[0];
  const draft = drafts[session.id] ?? blank();
  const selectedSkill = skills.find((s) => s.id === draft.skillId);
  const update = <K extends keyof Preferences>(key: K, value: Preferences[K]) =>
    setPrefs((p) => ({ ...p, [key]: value }));
  const changeDraft = (id: string, part: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? blank()), ...part } }));
  useEffect(() => {
    api<Connection>("status")
      .then(setConnection)
      .catch(() => setConnection(null));
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme;
    document.documentElement.dataset.density = prefs.compact
      ? "compact"
      : "comfortable";
    store("wiggle-preferences-v1", prefs);
  }, [prefs]);
  useEffect(() => {
    store("wiggle-sessions-v1", prefs.saveSessions ? sessions : undefined);
  }, [sessions, prefs.saveSessions]);
  useEffect(() => {
    store("wiggle-skills-v1", skills);
  }, [skills]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [session.id, session.messages.length, pending.length]);
  useEffect(() => {
    if (settings && !dialog.current?.open) dialog.current?.showModal();
    if (!settings && dialog.current?.open) dialog.current.close();
  }, [settings]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setSettings(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  function openSection(s: string, skillsFirst = false) {
    setSection(s);
    setSkillTab(skillsFirst);
    setSettingsQuery("");
    setSettings(true);
  }
  function newSession() {
    const s = fresh();
    setSessions((all) => [s, ...all]);
    setActive(s.id);
    setSessionQuery("");
    setFileError("");
    textarea.current?.focus();
  }
  function removeSession(id: string) {
    const next = sessions.filter((s) => s.id !== id);
    if (!next.length) next.push(fresh());
    setSessions(next);
    if (active === id) {
      setActive(next[0].id);
      setFileError("");
    }
    setDrafts(({ [id]: _, ...rest }) => rest);
  }
  function clearSessions() {
    const s = fresh();
    setSessions([s]);
    setActive(s.id);
    setDrafts({});
    setClearConfirm(false);
  }
  async function attach(file?: File) {
    if (!file) return;
    const id = session.id;
    setFileError("");
    try {
      if (
        file.size > 24000 ||
        /^(?:\.env(?:\.|$)|\.npmrc$|\.netrc$|id_(?:rsa|ed25519)$)|\.(?:pem|pfx|key)$/i.test(
          file.name,
        )
      )
        throw new Error("Choose a non-secret text file under 24 KB.");
      const content = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      if (!content.trim() || content.includes("\0"))
        throw new Error("Choose a non-empty UTF-8 text file.");
      changeDraft(id, { file: { name: file.name, content } });
    } catch (error) {
      setFileError(
        error instanceof TypeError
          ? "Choose a UTF-8 text file."
          : (error as Error).message,
      );
    }
  }
  async function submit() {
    const text = draft.text.trim();
    const id = session.id;
    if (!connection?.configured || !text || inFlight.current.has(id)) return;
    setFileError("");
    const context = [
      selectedSkill && `Skill: ${selectedSkill.name}`,
      draft.file && `File: ${draft.file.name}`,
    ]
      .filter(Boolean)
      .join(" · ");
    const next: Message[] = [
      ...session.messages,
      { role: "user", text, context },
    ];
    const content = [
      text,
      selectedSkill &&
        `User-selected skill (${selectedSkill.name}):\n${selectedSkill.text}`,
      draft.file &&
        `User-attached reference file (${draft.file.name}):\n${draft.file.content}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const history = session.messages
      .filter((m) => m.role !== "system")
      .slice(-60)
      .map((m) => ({ role: m.role, content: m.text }));
    // Keep the most recent messages inside the gateway's byte limit.
    const bytes = (value: unknown) =>
      new TextEncoder().encode(JSON.stringify(value)).length;
    const conversation = {
      messages: [...history, { role: "user", content }],
      instructions: prefs.instructions,
    };
    while (conversation.messages.length > 1 && bytes(conversation) > 240_000)
      conversation.messages.shift();
    if (conversation.messages[0].role === "assistant")
      conversation.messages.shift();
    changeDraft(id, blank());
    setSessions((all) =>
      all.map((s) =>
        s.id === id
          ? {
              ...s,
              name: s.messages.length ? s.name : text.slice(0, 40),
              messages: next,
            }
          : s,
      ),
    );
    inFlight.current.add(id);
    setPending((ids) => [...ids, id]);
    try {
      const data = await api<{ text: string }>("chat", post(conversation));
      setSessions((all) =>
        all.map((s) =>
          s.id === id
            ? {
                ...s,
                messages: [
                  ...s.messages,
                  { role: "assistant", text: data.text },
                ],
              }
            : s,
        ),
      );
    } catch (error) {
      setSessions((all) =>
        all.map((s) =>
          s.id === id
            ? {
                ...s,
                messages: [
                  ...s.messages,
                  { role: "system", text: (error as Error).message },
                ],
              }
            : s,
        ),
      );
    } finally {
      inFlight.current.delete(id);
      setPending((ids) => ids.filter((x) => x !== id));
    }
  }
  const waiting = pending.includes(session.id);
  const mode = connection?.configured
    ? "Model ready"
    : connection
      ? "Gateway ready"
      : "Static preview";
  return (
    <div className="app">
      <header className="titlebar">
        <div className="brand">
          <span className="brandmark">
            w<span>.</span>
          </span>
          <strong>WIGGLE</strong>
          <span className="brand-divider" />
          <span className="brand-sub">by Tervixa</span>
        </div>
        <div className="workspace">
          <Folder size={13} />
          <span>Personal workbench</span>
        </div>
        <div className="header-actions">
          <span className="prototype">{mode.toUpperCase()}</span>
          <button
            className="icon-button"
            aria-label="Toggle sessions panel"
            aria-pressed={sidebar}
            onClick={() => setSidebar(!sidebar)}
          >
            <LayoutPanelLeft size={16} />
          </button>
          <button
            className="icon-button details-toggle"
            aria-label="Toggle details panel"
            aria-pressed={right}
            onClick={() => setRight(!right)}
          >
            <PanelRight size={16} />
          </button>
        </div>
      </header>
      <div className="body">
        <nav className="rail" aria-label="Workbench actions">
          <button
            className="rail-button"
            title="Plugins"
            aria-label="Plugins"
            onClick={() => openSection("Plugins")}
          >
            <Plug size={18} />
          </button>
          <div className="rail-spacer" />
          <button
            className="rail-button"
            title="Settings"
            aria-label="Settings"
            onClick={() => openSection("General")}
          >
            <Settings size={18} />
          </button>
        </nav>
        {sidebar && (
          <aside className="sidebar" aria-label="Sessions">
            <div className="sidebar-heading">WORKSPACE</div>
            <button className="new-session" onClick={newSession}>
              <Plus size={15} />
              <span>New session</span>
            </button>
            <div className="side-label">SESSIONS</div>
            <div className="session-search">
              <SearchField
                label="Find a session"
                value={sessionQuery}
                onChange={setSessionQuery}
              />
            </div>
            <div className="session-list">
              {sessions
                .filter((s) =>
                  s.name.toLowerCase().includes(sessionQuery.toLowerCase()),
                )
                .map((s) => (
                  <div
                    key={s.id}
                    className={
                      "session-row " + (s.id === session.id ? "active" : "")
                    }
                  >
                    <button
                      className="session"
                      aria-label={`Open session: ${s.name}`}
                      title={s.name}
                      aria-current={s.id === session.id ? "true" : undefined}
                      onClick={() => {
                        setActive(s.id);
                        setFileError("");
                      }}
                    >
                      <MessageSquare size={14} />
                      <span>{s.name}</span>
                    </button>
                    <button
                      className="icon-button session-delete"
                      aria-label={`Delete ${s.name}`}
                      disabled={pending.includes(s.id)}
                      onClick={() => removeSession(s.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              {!sessions.some((s) =>
                s.name.toLowerCase().includes(sessionQuery.toLowerCase()),
              ) && <small className="no-sessions">No matching sessions.</small>}
            </div>
            <div className="sidebar-bottom">
              <span className={connection ? "status-dot" : "idle-dot"} />{" "}
              {prefs.saveSessions ? "Browser storage" : "Session only"}{" "}
              <span className="muted">v0.1</span>
            </div>
          </aside>
        )}
        <main className="workbench">
          <div className="tabs">
            <span className="tab active">
              <MessageSquare size={14} /> Chat
            </span>
            <div className="tabs-right">{session.name}</div>
          </div>
          <div className="chat-scroll">
            {session.messages.length === 0 ? (
              <div className="welcome">
                <div className="welcome-mark" aria-hidden="true">
                  w<i>.</i>
                </div>
                <div className="eyebrow">
                  <span
                    className={
                      connection?.configured ? "status-dot" : "idle-dot"
                    }
                  />{" "}
                  PERSONAL WORKBENCH
                </div>
                <h1>What are we working on?</h1>
                <p>
                  Discuss a change, plan a feature, or attach a file to review.
                </p>
                <div className="prompt-grid">
                  <button
                    onClick={() => {
                      changeDraft(session.id, {
                        text: "Review this file and point out changes worth making.",
                      });
                      textarea.current?.focus();
                    }}
                  >
                    <FileCode2 size={16} />
                    <span>
                      <strong>Review a file</strong>
                      <small>Get feedback on an attached file</small>
                    </span>
                    <ArrowRight size={14} />
                  </button>
                  <button
                    onClick={() => {
                      changeDraft(session.id, {
                        text: "Help me plan a new feature.",
                      });
                      textarea.current?.focus();
                    }}
                  >
                    <Braces size={16} />
                    <span>
                      <strong>Plan a feature</strong>
                      <small>Turn an idea into a clear plan</small>
                    </span>
                    <ArrowRight size={14} />
                  </button>
                </div>
                {!connection?.configured && (
                  <div className="preview-notice">
                    <CircleHelp size={14} />
                    {connection
                      ? "Connect a model below to send messages."
                      : "Browsing in preview. Start the local gateway to send messages."}
                  </div>
                )}
              </div>
            ) : (
              <div className="messages" role="log" aria-label="Conversation">
                {session.messages.map((m, i) => (
                  <div className="message" key={i}>
                    <div className={"avatar " + m.role}>
                      {m.role === "user" ? "Y" : "w."}
                    </div>
                    <div>
                      <div className="message-title">
                        {m.role === "user"
                          ? "You"
                          : m.role === "system"
                            ? "Notice"
                            : "Wiggle"}
                      </div>
                      {m.context && (
                        <small className="message-context">{m.context}</small>
                      )}
                      <p>{m.text}</p>
                    </div>
                  </div>
                ))}
                {waiting && (
                  <p className="waiting" role="status">
                    Waiting for provider…
                  </p>
                )}
                <div ref={end} />
              </div>
            )}
          </div>
          <div className="composer-wrap">
            <div className="composer">
              <textarea
                ref={textarea}
                aria-label="Message"
                placeholder="Ask a question or describe a task…"
                maxLength={8000}
                value={draft.text}
                onChange={(e) =>
                  changeDraft(session.id, { text: e.target.value })
                }
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.nativeEvent.isComposing &&
                    !e.shiftKey &&
                    (prefs.enterSends || e.ctrlKey || e.metaKey)
                  ) {
                    e.preventDefault();
                    void submit();
                  }
                }}
              />
              {(draft.file || fileError) && (
                <div className="attachments">
                  {draft.file && (
                    <span>
                      <Paperclip size={12} />
                      {draft.file.name}
                      <button
                        className="icon-button"
                        aria-label="Remove attachment"
                        onClick={() =>
                          changeDraft(session.id, { file: undefined })
                        }
                      >
                        <X size={13} />
                      </button>
                    </span>
                  )}
                  {fileError && <small role="alert">{fileError}</small>}
                </div>
              )}
              <div className="composer-footer">
                <div>
                  <label
                    className="file-action icon-button"
                    title="Attach text file"
                  >
                    <Paperclip size={15} />
                    <input
                      type="file"
                      aria-label="Attach text file"
                      onChange={(e) => {
                        void attach(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {skills.length > 0 ? (
                    <select
                      aria-label="Skill for next message"
                      className="composer-select"
                      value={selectedSkill?.id ?? ""}
                      onChange={(e) =>
                        changeDraft(session.id, { skillId: e.target.value })
                      }
                    >
                      <option value="">No skill</option>
                      {skills.map((s) => (
                        <option value={s.id} key={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <button
                      className="text-action skill-button"
                      onClick={() => openSection("Plugins", true)}
                    >
                      <BookOpen size={13} /> Skills
                    </button>
                  )}
                  <span className="composer-divider" />
                  <button
                    className="model-label text-action"
                    title={connection?.model}
                    onClick={() => openSection("Providers")}
                  >
                    {connection?.configured
                      ? connection.model
                      : "Connect a model"}
                  </button>
                </div>
                <button
                  className="send"
                  aria-label="Send message"
                  disabled={
                    !connection?.configured || !draft.text.trim() || waiting
                  }
                  onClick={() => void submit()}
                >
                  <ArrowUp size={16} />
                </button>
              </div>
            </div>
            <div className="composer-hint">
              <span>
                <kbd>{prefs.enterSends ? "Enter" : "Ctrl / ⌘ + Enter"}</kbd> to
                send
              </span>
              <span>Selected context goes to your model provider.</span>
            </div>
          </div>
        </main>
        {right && (
          <aside className="aux" aria-label="Session details">
            <div className="aux-tabs">
              <span>Overview</span>
            </div>
            <div className="aux-head">
              <div>
                <h3>Session overview</h3>
                <p>Connection and selected context</p>
              </div>
              <Activity size={16} />
            </div>
            <div className="overview-section">
              <div className="section-title">
                CONNECTION <span>01</span>
              </div>
              <div className="info-row">
                <span>Gateway</span>
                <strong>{connection ? "Local" : "Unavailable"}</strong>
              </div>
              <div className="info-row">
                <span>Provider</span>
                <strong title={connection?.provider}>
                  {connection?.configured
                    ? connection.provider
                    : "Not configured"}
                </strong>
              </div>
              <div className="info-row">
                <span>Model</span>
                <strong title={connection?.model}>
                  {connection?.configured ? connection.model : "—"}
                </strong>
              </div>
            </div>
            <div className="overview-section">
              <div className="section-title">
                SESSION <span>02</span>
              </div>
              <div className="info-row">
                <span>Status</span>
                <strong>{waiting ? "Waiting" : "Idle"}</strong>
              </div>
              <div className="info-row">
                <span>Messages</span>
                <strong>
                  {session.messages.filter((m) => m.role !== "system").length}
                </strong>
              </div>
              <div className="info-row">
                <span>Next message skill</span>
                <strong>{selectedSkill?.name || "None"}</strong>
              </div>
              <div className="info-row">
                <span>Attachment</span>
                <strong title={draft.file?.name}>
                  {draft.file?.name || "None"}
                </strong>
              </div>
            </div>
            <div className="aux-footer">
              <CircleHelp size={14} /> No tools run from chat.
            </div>
          </aside>
        )}
      </div>
      <footer className="statusbar">
        <div>
          <span className={connection ? "status-dot" : "idle-dot"} />
          {mode}
        </div>
        <div>UTF-8</div>
      </footer>
      <dialog
        ref={dialog}
        className="modal"
        aria-labelledby="settings-title"
        onClose={() => {
          setSettings(false);
          setClearConfirm(false);
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) dialog.current?.close();
        }}
      >
        {settings && (
          <div className="modal-shell">
            <div className="modal-head">
              <div>
                <Settings size={17} />
                <strong id="settings-title">Settings</strong>
              </div>
              <button
                className="icon-button"
                aria-label="Close settings"
                onClick={() => setSettings(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <nav className="settings-nav" aria-label="Settings sections">
                <SearchField
                  label="Find a setting"
                  value={settingsQuery}
                  onChange={setSettingsQuery}
                />
                {groups.map((g) => {
                  const list = g.sections.filter((s) =>
                    s.toLowerCase().includes(settingsQuery.toLowerCase()),
                  );
                  return (
                    list.length > 0 && (
                      <div key={g.name}>
                        <div className="side-label">{g.name}</div>
                        {list.map((s) => (
                          <button
                            aria-current={s === section ? "page" : undefined}
                            className={s === section ? "active" : ""}
                            key={s}
                            onClick={() => {
                              setSection(s);
                              setSkillTab(false);
                              setClearConfirm(false);
                            }}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )
                  );
                })}
                {!sections.some((s) =>
                  s.toLowerCase().includes(settingsQuery.toLowerCase()),
                ) && <small>No matching settings.</small>}
              </nav>
              <div className="settings-content" key={`${section}:${skillTab}`}>
                <div className="eyebrow">
                  SETTINGS / {section.toUpperCase()}
                </div>
                <h2>{section}</h2>
                {section === "Providers" && (
                  <Providers
                    connection={connection}
                    onConnect={setConnection}
                  />
                )}
                {section === "Plugins" && (
                  <Plugins
                    available={Boolean(connection)}
                    skills={skills}
                    setSkills={setSkills}
                    initialTab={skillTab ? "Skills" : "Connectors"}
                  />
                )}
                {section === "General" && (
                  <>
                    <p>Choose how the composer works.</p>
                    <Row
                      name="Enter to send"
                      help="When off, use Ctrl / ⌘ + Enter to send."
                    >
                      <Toggle
                        name="Enter to send"
                        checked={prefs.enterSends}
                        onChange={(v) => update("enterSends", v)}
                      />
                    </Row>
                  </>
                )}
                {section === "Appearance" && (
                  <>
                    <p>Adjust the workbench without changing chat behavior.</p>
                    <Row name="Color theme" help="Set the workbench theme.">
                      <select
                        aria-label="Color theme"
                        value={prefs.theme}
                        onChange={(e) =>
                          update(
                            "theme",
                            e.target.value as Preferences["theme"],
                          )
                        }
                      >
                        <option value="dark">Carbon dark</option>
                        <option value="light">Crisp light</option>
                      </select>
                    </Row>
                    <Row
                      name="Compact layout"
                      help="Reduce spacing in messages, sessions, and catalogs."
                    >
                      <Toggle
                        name="Compact layout"
                        checked={prefs.compact}
                        onChange={(v) => update("compact", v)}
                      />
                    </Row>
                  </>
                )}
                {section === "Shortcuts" && (
                  <>
                    <p>Keyboard shortcuts available in the workbench.</p>
                    <Row
                      name="Open settings"
                      help="From anywhere in the workbench"
                    >
                      <kbd>Ctrl / ⌘ + ,</kbd>
                    </Row>
                    <Row name="Close settings" help="Return to the workbench">
                      <kbd>Esc</kbd>
                    </Row>
                    <Row name="Send message" help="Composer shortcut">
                      <kbd>
                        {prefs.enterSends ? "Enter" : "Ctrl / ⌘ + Enter"}
                      </kbd>
                    </Row>
                    <Row name="New line" help="Composer shortcut">
                      <kbd>Shift + Enter</kbd>
                    </Row>
                  </>
                )}
                {section === "Instructions" && (
                  <>
                    <p>
                      Optional preferences for all chat responses. These are
                      sent alongside each request, after Wiggle’s built-in
                      identity instruction.
                    </p>
                    <label className="field">
                      <span>Personal instructions</span>
                      <textarea
                        maxLength={2000}
                        rows={6}
                        value={prefs.instructions}
                        placeholder="For example: Prefer concise answers with test suggestions."
                        onChange={(e) => update("instructions", e.target.value)}
                      />
                    </label>
                    <small className="inline-note">
                      {prefs.instructions.length}/2000 · Saved in this browser
                    </small>
                  </>
                )}
                {section === "Privacy & history" && (
                  <>
                    <p>
                      Chat history is stored only in this browser when enabled.
                      No automatic memory extraction or syncing is performed.
                      Attachment and skill bodies are not saved in chat history.
                    </p>
                    <Row
                      name="Save sessions"
                      help="Turn off to remove stored sessions while keeping open chats until reload."
                    >
                      <Toggle
                        name="Save sessions"
                        checked={prefs.saveSessions}
                        onChange={(v) => update("saveSessions", v)}
                      />
                    </Row>
                    <Row
                      name="Clear chats"
                      help="Delete all open and saved chat sessions on this browser."
                    >
                      <button
                        className="action"
                        onClick={() => setClearConfirm(true)}
                      >
                        Clear chats
                      </button>
                    </Row>
                    {clearConfirm && (
                      <div className="settings-note">
                        <span>This cannot be undone.</span>
                        <button
                          className="action"
                          onClick={() => setClearConfirm(false)}
                        >
                          Cancel
                        </button>
                        <button
                          className="action primary"
                          onClick={clearSessions}
                        >
                          Delete all
                        </button>
                      </div>
                    )}
                  </>
                )}
                {section === "Permissions" && (
                  <>
                    <p>
                      The workbench uses explicit file attachments and does not
                      give models workspace or shell access.
                    </p>
                    <Row
                      name="Files"
                      help="Only text files explicitly attached to a message are sent."
                    >
                      <Check size={15} />
                    </Row>
                    <Row
                      name="Connector tools"
                      help="Tests discover names only and never invoke a listed tool."
                    >
                      <Check size={15} />
                    </Row>
                    <Row
                      name="Terminal, browser and Git"
                      help="No shell execution, browser automation, Git writes or push access is provided."
                    >
                      <Check size={15} />
                    </Row>
                  </>
                )}
                {section === "About" && (
                  <>
                    <p>Tervixa Wiggle · Workbench preview v0.1</p>
                    <div className="settings-note">
                      <CircleHelp size={16} /> The static preview lets you
                      browse providers, add and inspect library entries, and
                      manage local settings. Run the local gateway for live
                      model requests and MCP inspection.
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
