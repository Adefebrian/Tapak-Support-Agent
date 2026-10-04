import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Icon, Logo } from "./components/Icon.tsx";
import { type Health, api, defaultBase, getBase, setBase } from "./lib/api.ts";
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

function Settings({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState(getBase());
  return (
    <div
      className="overlay"
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <motion.div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
      >
        <h2 id="settings-title" className="panel-title" style={{ fontSize: 18 }}>
          Settings
        </h2>
        <div className="field">
          <label htmlFor="base">Backend address</label>
          <input
            id="base"
            value={value}
            placeholder={defaultBase() || "same origin"}
            onChange={(e) => setValue(e.target.value)}
          />
          <small>
            Leave empty to use the default. Desktop: http://localhost:8787. Android emulator:
            http://10.0.2.2:8787.
          </small>
        </div>
        <div className="row-end">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setBase(value);
              location.reload();
            }}
          >
            Save
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export function App() {
  const [tab, setTab] = useState<TabId>(initialTab);
  const [health, setHealth] = useState<Health | null>(null);
  const [settings, setSettings] = useState(false);

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
          <div className="status">
            <span className="pill" title="Language model provider">
              LLM {health?.llm.split(":")[0] ?? "offline"}
            </span>
            <span className="pill" title="Decision layer">
              JEV {health?.jev ?? "offline"}
            </span>
          </div>
          <button type="button" className="icon-btn" aria-label="Settings" onClick={() => setSettings(true)}>
            <Icon name="settings" />
          </button>
        </header>
        <main>
          {/* Chat stays mounted so the conversation survives tab switches. */}
          <div hidden={tab !== "chat"}>
            <ChatView />
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
        <AnimatePresence>{settings && <Settings onClose={() => setSettings(false)} />}</AnimatePresence>
      </div>
    </MotionConfig>
  );
}
