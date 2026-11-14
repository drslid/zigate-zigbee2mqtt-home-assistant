import {messages} from "./messages.js?v=2";
import {languages, pages, pagePath} from "./site-routes.js";

const storageKey = "zigate.language";
const liveText = new Map();
export const languageEvents = new EventTarget();
// The hardware modules also run standalone, where their diagnostics default to French.
const page = typeof document === "undefined" ? null : document.documentElement;
const siteRoot = new URL("./", import.meta.url);
const fixedLanguage = page?.hasAttribute("data-fixed-language");
let language = page ? (fixedLanguage ? page.lang : detectLanguage()) : "fr";

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
    page.lang = language;
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

function bindLanguagePicker(picker) {
    const summary = picker.querySelector("summary");
    const links = picker.querySelectorAll("a[hreflang]");
    const pageName = page.dataset.sitePage;
    const config = pages[pageName];
    for (const link of links) {
        link.href = new URL(pagePath(pageName, link.hreflang), siteRoot).href;
        const icon = link.querySelector("img");
        icon.src = new URL(`./assets/flags/${languages[link.hreflang][1]}.png`, siteRoot).href;
    }
    for (const attribute of ["href", "src"]) {
        for (const element of document.querySelectorAll(`[data-site-${attribute}]`)) {
            element.setAttribute(attribute, new URL(element.getAttribute(`data-site-${attribute}`), siteRoot).href);
        }
    }

    function updatePicker() {
        const [name, code] = languages[language];
        const label = `${t("language")} (${name})`;
        summary.replaceChildren(flag(code));
        summary.setAttribute("aria-label", label);
        summary.title = label;
        for (const link of links) {
            if (link.hreflang === language) link.setAttribute("aria-current", "true");
            else link.removeAttribute("aria-current");
        }
        for (const link of document.querySelectorAll("a[data-site-page]")) {
            const hash = link.dataset.siteHash ?? "";
            link.href = new URL(pagePath(link.dataset.sitePage, language) + hash, siteRoot).href;
        }
    }

    function updateMetadata() {
        const url = document.head.querySelector(`link[hreflang="${language}"]`).href;
        document.head.querySelector('link[rel="canonical"]').href = url;
        const properties = {url, title: t(config.title), description: t(config.description), locale: languages[language][2]};
        for (const [name, content] of Object.entries(properties)) {
            document.head.querySelector(`meta[property="og:${name}"]`).content = content;
        }
        const alternates = Object.keys(languages).filter(code => code !== language);
        document.head.querySelectorAll('meta[property="og:locale:alternate"]').forEach((element, index) => {
            element.content = languages[alternates[index]][2];
        });
        const imageAlt = pageName === "dashboard" ? "heroPhoto" : "radioFlashPhoto";
        document.head.querySelector('meta[property="og:image:alt"]').content = t(imageAlt);
    }

    for (const link of links) {
        link.addEventListener("click", (event) => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            picker.open = false;
            summary.focus();
            const nextLanguage = link.hreflang;
            try {
                localStorage.setItem(storageKey, nextLanguage);
            } catch {
                // Keep the new language for the current page.
            }
            const url = new URL(link.href);
            url.search = location.search;
            url.hash = location.hash;
            if (url.pathname !== location.pathname) history.replaceState(history.state, "", url);
            if (nextLanguage !== language) {
                language = nextLanguage;
                translatePage();
                languageEvents.dispatchEvent(new Event("change"));
            }
            updateMetadata();
            updatePicker();
        });
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

    if (page.lang !== language) translatePage();
    if (!fixedLanguage && language !== "en") {
        const url = new URL(pagePath(pageName, language), siteRoot);
        url.search = location.search;
        url.hash = location.hash;
        history.replaceState(history.state, "", url);
        updateMetadata();
    }
    updatePicker();
}

if (page && Object.hasOwn(pages, page.dataset.sitePage)) {
    const picker = document.querySelector(".language-picker");
    if (picker) bindLanguagePicker(picker);
}
