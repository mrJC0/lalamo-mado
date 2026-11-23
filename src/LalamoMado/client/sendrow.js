// Who answers a send. The checkboxes compose it by hand and are always there; a send button is a whole setup under one click.
// All off is the full in-session reply. May edit never sticks: a red chip is the quick way.
// The picked model and effort are this send's either way; a button with a model or effort of its own keeps it.

import { preference, savePreference } from "./prefs.js";

const TICKS_KEY = "delegated.ticks";
const MODELS_KEY = "delegated.models";
const BUTTONS_HELP = "A button is quick access to a setup you use often, with a pre-prompt of your own. The checkboxes stay, as the full capability. Ask the agent to turn any way of answering you keep needing into a button.";
const NOT_SEEN_WARNING = "The session will not see this thread.";
const BRIEFED_WARNING = "The session writes the brief and sees nothing after it.";
// A stop per level `claude --effort` takes; the first leaves the model's own default.
const EFFORTS = [
  { level: null, name: "model's default", note: "the model decides; medium on the 5.5 models" },
  { level: "low", name: "low", note: "fastest and cheapest, for a quick lookup" },
  { level: "medium", name: "medium", note: "a balance of speed and depth" },
  { level: "high", name: "high", note: "thinks more, takes longer and costs more; the default here" },
  { level: "xhigh", name: "xhigh", note: "more again, for a hard question" },
  { level: "max", name: "max", note: "the most thinking; slowest and most expensive" },
];
const DEFAULT_EFFORT = "high";
const MAY_EDIT_WARNING = "This run edits files in the repo itself, at once, and the session will not know.";

let buttons = [];
const liveRows = new Set();

export function setSendButtons(list) {
  buttons = list;
  for (const row of liveRows) row.renderChips();
}

const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

function tickBox(name, text) {
  const box = el("input", { type: "checkbox" });
  box.dataset.tick = name;
  return { box, label: el("label", { className: `send-tick tick-${name}` }, [box, ` ${text}`]) };
}

/** @param onButton a send button was clicked, with the picked model and effort; @param onChange the ticks changed, so what Send now says did too. */
export function createSendRow({ onButton, onChange, onSaved }) {
  const newAgent = tickBox("new", "New agent");
  const repo = tickBox("repo", "Repo context");
  const brief = tickBox("brief", "Brief");
  const edit = tickBox("edit", "May edit");
  const model = el("select", { title: "Which model answers", ariaLabel: "Model" });
  const effort = el("input", { type: "range", min: 0, max: EFFORTS.length - 1, step: 1, ariaLabel: "Effort" });
  const effortName = el("span", { className: "send-effort-name" });
  const effortBox = el("label", { className: "send-effort" }, ["Effort ", effort, effortName]);
  const pickedEffort = () => EFFORTS[effort.valueAsNumber];
  const save = el("button", { type: "button", className: "send-save", textContent: "💾", title: "Keep these ticks as this PC's default; May edit never sticks" });
  const chips = el("div", { className: "send-chips" });
  const warning = el("p", { className: "send-warning" });
  const node = el("div", { className: "send-row" }, [
    chips,
    el("div", { className: "send-ticks" }, [newAgent.label, repo.label, brief.label, model, effortBox, edit.label, save]),
    warning,
  ]);
  const dependents = [repo.box, brief.box, edit.box];

  function refresh() {
    for (const control of dependents) control.disabled = !newAgent.box.checked;
    const active = newAgent.box.checked;
    const lines = active ? [brief.box.checked ? BRIEFED_WARNING : NOT_SEEN_WARNING, ...(edit.box.checked ? [MAY_EDIT_WARNING] : [])] : [];
    warning.textContent = lines.join(" ");
    warning.hidden = lines.length === 0;
    warning.classList.toggle("edits", active && edit.box.checked);
    onChange?.(row);
  }

  function showEffort() {
    effortName.textContent = pickedEffort().name;
    effortBox.title = `How hard a separate run thinks: ${pickedEffort().name} — ${pickedEffort().note}. With every tick off the session answers, at its own level.`;
  }

  function fillModels(selected) {
    const known = preference(MODELS_KEY, []);
    model.replaceChildren(el("option", { value: "", textContent: "Default" }), ...known.map(({ id, name }) => el("option", { value: id, textContent: name ?? id })));
    model.value = known.some(({ id }) => id === selected) ? selected : "";
  }

  const row = {
    node,
    open: false,
    renderChips() {
      chips.replaceChildren(
        ...buttons.map((button) => {
          const description = button.description ?? button.name;
          const ownModelNote = button.model ? ` Always ${button.model}.` : "";
          const chip = el("button", {
            type: "button",
            className: `send-chip${button.edit ? " edits" : ""}`,
            textContent: `${button.icon} ${button.name}`,
            title: `${description}${ownModelNote}${button.edit ? ` ${MAY_EDIT_WARNING}` : ""}`,
          });
          chip.dataset.button = button.id;
          chip.addEventListener("mousedown", (event) => event.preventDefault());
          chip.addEventListener("click", () => onButton(button, model.value || null, pickedEffort().level));
          return chip;
        }),
        el("span", { className: "send-help", textContent: "❔", title: BUTTONS_HELP }),
      );
    },
    /** Back to this PC's default ticks, or all off. */
    reset() {
      const kept = preference(TICKS_KEY, {});
      newAgent.box.checked = !!kept.newAgent;
      repo.box.checked = !!kept.repo;
      brief.box.checked = !!kept.brief;
      edit.box.checked = false;
      fillModels(kept.model ?? "");
      // A saved null is the model's default, picked on purpose; only nothing saved falls back to high.
      const keptStop = EFFORTS.findIndex(({ level }) => level === (kept.effort === undefined ? DEFAULT_EFFORT : kept.effort));
      effort.value = String(Math.max(keptStop, 0));
      showEffort();
      refresh();
    },
    /** What the wire says about who answers; null is the session. */
    ticks() {
      return newAgent.box.checked ? { repo: repo.box.checked, brief: brief.box.checked, model: model.value || null, effort: pickedEffort().level, edit: edit.box.checked } : null;
    },
    sendNowText() {
      if (!newAgent.box.checked) return "Send now";
      const parts = [model.selectedOptions[0]?.textContent ?? "Default", ...(pickedEffort().level ? [pickedEffort().level] : []), repo.box.checked ? "repo" : "blank"];
      if (brief.box.checked) parts.push("briefed");
      if (edit.box.checked) parts.push("may edit");
      return `Send now · ${parts.join(" ")}`;
    },
  };

  for (const { box } of [newAgent, repo, brief]) box.addEventListener("change", refresh);
  model.addEventListener("change", refresh);
  effort.addEventListener("input", () => {
    showEffort();
    refresh();
  });
  edit.box.addEventListener("change", () => {
    if (edit.box.checked) repo.box.checked = true;
    refresh();
  });
  save.addEventListener("click", () => {
    savePreference("pc", TICKS_KEY, { newAgent: newAgent.box.checked, repo: repo.box.checked, brief: brief.box.checked, model: model.value, effort: pickedEffort().level });
    onSaved?.();
  });
  liveRows.add(row);
  row.renderChips();
  row.reset();
  return row;
}
