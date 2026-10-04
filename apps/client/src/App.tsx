import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { type FormEvent, useEffect, useState } from "react";
import { Logo } from "./components/Brand.tsx";
import { Icon } from "./components/Icon.tsx";
import { type Health, type LiveConfig, api, defaultBase, getBase, setBase } from "./lib/api.ts";
import { ChatView } from "./views/ChatView.tsx";
import { EscalationsView } from "./views/EscalationsView.tsx";
import { SystemView } from "./views/SystemView.tsx";
import { TracesView } from "./views/TracesView.tsx";

const TABS = [
  { id: "chat", label: "Chat", short: "Chat" },
  { id: "escalations", label: "Escalations", short: "Queue" },
  { id: "traces", label: "Traces", short: "Traces" },
  { id: "system", label: "How it works", short: "System" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function initialTab(): TabId {
  const h = new URLSearchParams(location.search).get("tab") ?? location.hash.replace("#", "");
  return (TABS.find((t) => t.id === h)?.id ?? "chat") as TabId;
}

const MODELS = { openai: "gpt-4o-mini", anthropic: "claude-sonnet-5-5" } as const;

function LiveModeDialog({
  current,
  available,
  onApply,
  onClose,
}: {
  current: LiveConfig | null;
  available: boolean;
  onApply: (cfg: LiveConfig | null) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"mock" | "live">(current ? "live" : "mock");
  const [provider, setProvider] = useState<"openai" | "anthropic">(current?.llm?.provider ?? "openai");
  const [model, setModel] = useState(current?.llm?.model ?? MODELS[current?.llm?.provider ?? "openai"]);
  const [llmKey, setLlmKey] = useState(current?.llm?.api_key ?? "");
  const [useJev, setUseJev] = useState(!!current?.jev);
  const [jevKey, setJevKey] = useState(current?.jev?.api_key ?? "");
  const [base, setBaseValue] = useState(getBase());

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (base !== getBase()) setBase(base);
    if (mode === "mock") return onApply(null);
    const cfg: LiveConfig = {};
    if (llmKey.trim()) cfg.llm = { provider, api_key: llmKey.trim(), model: model.trim() || undefined };
    if (useJev && jevKey.trim()) cfg.jev = { api_key: jevKey.trim() };
    onApply(cfg.llm || cfg.jev ? cfg : null);
  };

  const canSubmit = mode === "mock" || llmKey.trim().length > 0 || (useJev && jevKey.trim().length > 0);

  return (
    <div
      className="overlay"
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <motion.form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="live-title"
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <div className="dialog-head">
          <h2 id="live-title" className="panel-title">
            Agent mode
          </h2>
          <p className="panel-sub">
            Mock mode needs no key. Live mode sends your key once to this server, which keeps it in memory for
            this conversation only (one hour at most). It is never saved, logged, or sent back.
          </p>
        </div>

        <div className="segmented segmented-full" role="group" aria-label="Mode">
          <button type="button" aria-pressed={mode === "mock"} onClick={() => setMode("mock")}>
            Mock
          </button>
          <button
            type="button"
            aria-pressed={mode === "live"}
            onClick={() => setMode("live")}
            disabled={!available}
          >
            Live
          </button>
        </div>
        {!available && (
          <p className="panel-sub">Live mode is turned off on this server (ALLOW_BYOK=false).</p>
        )}

        {mode === "live" && (
          <div className="form-grid">
            <div className="field">
              <label htmlFor="provider">Model provider</label>
              <select
                id="provider"
                value={provider}
                onChange={(e) => {
                  const p = e.target.value as "openai" | "anthropic";
                  setProvider(p);
                  setModel(MODELS[p]);
                }}
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="model">Model</label>
              <input id="model" value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} />
            </div>
            <div className="field field-wide">
              <label htmlFor="llm-key">{provider === "openai" ? "OpenAI" : "Anthropic"} API key</label>
              <input
                id="llm-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={llmKey}
                onChange={(e) => setLlmKey(e.target.value)}
                placeholder={provider === "openai" ? "sk-..." : "sk-ant-..."}
              />
            </div>
            <label className="check field-wide">
              <input type="checkbox" checked={useJev} onChange={(e) => setUseJev(e.target.checked)} />
              <span>Use JEV as the decision layer</span>
            </label>
            {useJev && (
              <div className="field field-wide">
                <label htmlFor="jev-key">JEV API key</label>
                <input
                  id="jev-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={jevKey}
                  onChange={(e) => setJevKey(e.target.value)}
                  placeholder="apikey_..."
                />
              </div>
            )}
          </div>
        )}

        <div className="field">
          <label htmlFor="base">Backend address</label>
          <input
            id="base"
            value={base}
            placeholder={defaultBase() || "This server"}
            onChange={(e) => setBaseValue(e.target.value)}
            spellCheck={false}
          />
          <small>Only needed in the desktop or Android app. Android emulator: http://10.0.2.2:8787</small>
        </div>

        <div className="row-end">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={!canSubmit}>
            {mode === "live" ? "Start live conversation" : "Use mock mode"}
          </button>
        </div>
      </motion.form>
    </div>
  );
}

export function App() {
  const [tab, setTab] = useState<TabId>(initialTab);
  const [health, setHealth] = useState<Health | null>(null);
  const [dialog, setDialog] = useState(false);
  // The key lives only in this variable for the life of the page: no storage, no URL.
  const [live, setLive] = useState<LiveConfig | null>(null);
  const [nonce, setNonce] = useState(0);
  const [mode, setMode] = useState("default");

  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const go = (t: TabId) => {
    setTab(t);
    history.replaceState(null, "", `#${t}`);
  };

  const modeLabel =
    mode === "default"
      ? health
        ? health.llm.startsWith("mock")
          ? "Mock mode"
          : health.llm
        : "Offline"
      : `Live: ${mode}`;

  return (
    <MotionConfig reducedMotion="user">
      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <Logo size={32} />
            <div className="brand-name">
              Tapak <span>Support</span>
            </div>
          </div>
          <nav className="tabs" role="tablist" aria-label="Sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                className="tab"
                aria-selected={tab === t.id}
                onClick={() => go(t.id)}
              >
                <span className="tab-long">{t.label}</span>
                <span className="tab-short">{t.short}</span>
                {tab === t.id && (
                  <motion.span
                    layoutId="tab-ind"
                    className="tab-indicator"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
              </button>
            ))}
          </nav>
          <button
            type="button"
            className="mode-btn"
            onClick={() => setDialog(true)}
            aria-label={`Agent mode: ${modeLabel}`}
          >
            <span className={`status-mark ${mode !== "default" ? "is-orange" : ""}`} aria-hidden="true" />
            <span className="mode-text">{modeLabel}</span>
            <Icon name="settings" size={16} />
          </button>
        </header>
        <main>
          {/* Chat stays mounted so the conversation survives tab switches. */}
          <div hidden={tab !== "chat"}>
            <ChatView live={live} nonce={nonce} onMode={setMode} />
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              {tab === "escalations" && <EscalationsView />}
              {tab === "traces" && <TracesView />}
              {tab === "system" && <SystemView />}
            </motion.div>
          </AnimatePresence>
        </main>
        <AnimatePresence>
          {dialog && (
            <LiveModeDialog
              current={live}
              available={health?.live_mode_available ?? true}
              onClose={() => setDialog(false)}
              onApply={(cfg) => {
                setLive(cfg);
                setNonce((n) => n + 1);
                setDialog(false);
                go("chat");
              }}
            />
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
