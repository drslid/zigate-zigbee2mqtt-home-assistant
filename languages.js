import {messages} from "./messages.js?v=1";

const languages = {
    en: ["English", "gb"],
    fr: ["Français", "fr"],
    es: ["Español", "es"],
    it: ["Italiano", "it"],
    pt: ["Português", "pt"],
    de: ["Deutsch", "de"],
};
const storageKey = "zigate.language";
const liveText = new Map();
export const languageEvents = new EventTarget();
// The hardware modules also run standalone, where their diagnostics default to French.
let language = typeof document === "undefined" ? "fr" : detectLanguage();

function detectLanguage() {
    try {
        const saved = localStorage.getItem(storageKey);
        if (Object.hasOwn(languages, saved)) return saved;
    } catch {
        // The selector also works when storage is unavailable.
    }
    for (const locale of [...(navigator.languages ?? []), navigator.language]) {
        const code = locale?.toLowerCase().split("-")[0];
        if (Object.hasOwn(languages, code)) return code;
    }
    return "en";
}

export function t(key, values = {}) {
    const text = messages[language][key] ?? messages.en[key];
    return text.replace(/\{(\w+)\}/g, (_, name) => {
        const value = values[name];
        return typeof value === "function" ? value() : value;
    });
}

export class LocalizedError extends Error {
    constructor(key, values, options) {
        super(t(key, values), options);
        this.key = key;
        this.values = values;
    }

    translate() {
        return t(this.key, this.values);
    }
}

export function setText(element, message) {
    if (message) {
        const render = typeof message === "function" ? message : () => t(message);
        liveText.set(element, render);
        const text = render();
        if (element.textContent !== text) element.textContent = text;
    } else {
        liveText.delete(element);
        element.textContent = "";
    }
}

function translatePage() {
    document.documentElement.lang = language;
    for (const element of document.querySelectorAll("[data-i18n]")) {
        const template = document.createElement("template");
        // Catalog entries are local constants, and numbered slots reuse the existing DOM nodes.
        template.innerHTML = t(element.dataset.i18n).replace(/@(\d+)@/g, '<span data-slot="$1"></span>');
        for (const slot of template.content.querySelectorAll("[data-slot]")) {
            slot.replaceWith(element.querySelector(`:scope > [data-i18n-slot="${slot.dataset.slot}"]`));
        }
        element.replaceChildren(template.content);
    }
    for (const attribute of ["aria-label", "alt", "content", "title"]) {
        const translation = `data-i18n-${attribute}`;
        for (const element of document.querySelectorAll(`[${translation}]`)) {
            element.setAttribute(attribute, t(element.getAttribute(translation)));
        }
    }
    for (const [element, render] of liveText) {
        element.textContent = render();
    }
}

function flag(code) {
    const img = document.createElement("img");
    // Public-domain flag images from https://flagpedia.net/download.
    img.src = new URL(`./assets/flags/${code}.png`, import.meta.url).href;
    img.alt = "";
    img.width = 22;
    img.height = 15;
    return img;
}

function addLanguagePicker(header) {
    const picker = document.createElement("details");
    picker.className = "language-picker";
    const summary = document.createElement("summary");
    picker.append(summary);
    const list = document.createElement("ul");
    picker.append(list);

    function updatePicker() {
        const [name, code] = languages[language];
        const label = `${t("language")} (${name})`;
        summary.replaceChildren(flag(code));
        summary.setAttribute("aria-label", label);
        summary.title = label;
        for (const button of list.querySelectorAll("button")) {
            button.setAttribute("aria-pressed", String(button.lang === language));
        }
    }

    for (const [id, [name, code]] of Object.entries(languages)) {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.lang = id;
        button.append(flag(code), name);
        button.addEventListener("click", () => {
            picker.open = false;
            summary.focus();
            if (id === language) return;
            language = id;
            try {
                localStorage.setItem(storageKey, language);
            } catch {
                // Keep the new language for the current page.
            }
            translatePage();
            updatePicker();
            languageEvents.dispatchEvent(new Event("change"));
        });
        item.append(button);
        list.append(item);
    }

    picker.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && picker.open) {
            picker.open = false;
            summary.focus();
            event.preventDefault();
        }
    });
    document.addEventListener("click", (event) => {
        if (!picker.contains(event.target)) picker.open = false;
    });

    updatePicker();
    header.append(picker);
}

if (typeof document !== "undefined") {
    const header = document.querySelector(".header-actions");
    if (header) {
        translatePage();
        addLanguagePicker(header);
    }
}
