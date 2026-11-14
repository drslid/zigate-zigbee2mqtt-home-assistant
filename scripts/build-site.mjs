import assert from "node:assert/strict";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {load} from "cheerio";
import {messages} from "../messages.js";
import {languages, pages, pagePath} from "../site-routes.js";

const root = new URL("../", import.meta.url);
const site = new URL("https://drslid.github.io/zigate-zigbee2mqtt-home-assistant/");
const locales = Object.keys(languages);
const localizedAttributes = ["aria-label", "alt", "content", "title"];
const targets = [null, ...locales];

function translate($, catalog) {
    function message(key) {
        assert.ok(Object.hasOwn(catalog, key), `Missing translation: ${key}`);
        return catalog[key];
    }
    for (const node of $("[data-i18n]").get().reverse()) {
        const element = $(node);
        const html = message(element.attr("data-i18n"));
        const slots = new Map();
        element.children("[data-i18n-slot]").each((_, child) => {
            slots.set($(child).attr("data-i18n-slot"), $.html(child));
        });
        const used = new Set();
        element.html(html.replace(/@(\d+)@/g, (_, index) => {
            assert.ok(slots.has(index) && !used.has(index), `Invalid HTML slot: ${index}`);
            used.add(index);
            return slots.get(index);
        }));
        assert.equal(used.size, slots.size, "Every HTML slot must be present");
    }
    for (const attribute of localizedAttributes) {
        const key = `data-i18n-${attribute}`;
        $(`[${key}]`).each((_, node) => $(node).attr(attribute, message($(node).attr(key))));
    }
}

function addMetadata($, page, language, catalog) {
    const canonical = new URL(pagePath(page, language), site).href;
    const images = {
        dashboard: {path: "assets/guide/zigate-boitier.webp", width: 560, height: 292, alt: "heroPhoto"},
        drivers: {path: "assets/guide/radio-sur-usb-ttl.webp", width: 620, height: 244, alt: "radioFlashPhoto"},
    };
    const image = images[page];
    const head = $("head");
    function append(tag, attributes) {
        head.append("  ", $(`<${tag}>`).attr({"data-site-meta": "", ...attributes}), "\n");
    }
    append("link", {rel: "canonical", href: canonical});
    for (const locale of [...locales, "x-default"]) {
        append("link", {rel: "alternate", hreflang: locale, href: new URL(pagePath(page, locale === "x-default" ? "en" : locale), site).href});
    }

    const graph = {
        title: catalog[pages[page].title],
        description: catalog[pages[page].description],
        type: "website",
        url: canonical,
        site_name: "ZiGate · Zigbee2MQTT",
        locale: languages[language][2],
        image: new URL(image.path, site).href,
        "image:type": "image/webp",
        "image:width": String(image.width),
        "image:height": String(image.height),
        "image:alt": catalog[image.alt],
    };
    for (const [name, content] of Object.entries(graph)) {
        append("meta", {property: `og:${name}`, content});
    }
    for (const alternate of locales.filter(locale => locale !== language)) {
        append("meta", {property: "og:locale:alternate", content: languages[alternate][2]});
    }
    append("meta", {name: "twitter:card", content: "summary_large_image"});
}

function setSiteLinks($, language) {
    const prefix = language ? "../" : "./";
    $("a[data-site-page]").each((_, node) => {
        const link = $(node);
        const path = pagePath(link.attr("data-site-page"), language);
        const hash = link.attr("data-site-hash") ?? "";
        link.attr("href", prefix + path + hash);
    });
    $("[data-site-href], [data-site-src]").each((_, node) => {
        const element = $(node);
        for (const attribute of ["href", "src"]) {
            const path = element.attr(`data-site-${attribute}`);
            if (path) element.attr(attribute, prefix + path);
        }
    });
}

function addPicker($, page, locale, language, catalog) {
    function flag(code) {
        return $("<img>").attr({src: (locale ? "../" : "./") + `assets/flags/${code}.png`, alt: "", width: "22", height: "15"});
    }
    const [activeName, activeFlag] = languages[language];
    const label = `${catalog.language} (${activeName})`;
    const summary = $("<summary>").attr({"aria-label": label, title: label}).append(flag(activeFlag));
    const list = $("<ul>");
    for (const [code, [name, country]] of Object.entries(languages)) {
        const link = $("<a>").attr({
            href: (locale ? "../" : "./") + pagePath(page, code),
            lang: code,
            hreflang: code,
        }).append(flag(country), name);
        if (code === language) link.attr("aria-current", "true");
        list.append($("<li>").append(link));
    }
    const details = $("<details>").addClass("language-picker")
        .append("\n          ", summary, "\n          ", list, "\n        ");
    for (const item of list.children().get()) $(item).before("\n            ");
    list.append("\n          ");
    $("header .header-actions").append("\n        ", details, "\n      ");
}

for (const [page, config] of Object.entries(pages)) {
    const template = await readFile(new URL(config.file, root), "utf8");
    for (const locale of targets) {
        const language = locale ?? "en";
        const catalog = messages[language];
        const $ = load(template, {scriptingEnabled: false});
        $("html").attr({lang: language, "data-site-page": page});
        if (locale) $("html").attr("data-fixed-language", "");
        else $("html").removeAttr("data-fixed-language");
        $("[data-site-meta], .language-picker").remove();
        for (const element of [$(".header-actions"), $("body")]) {
            for (const node of element.contents().get().reverse()) {
                if (node.type !== "text" || node.data.trim()) break;
                $(node).remove();
            }
        }
        $("body").append("\n");
        // Keep the template stable when the compatibility pages are regenerated.
        $("head").contents().filter((_, node) => node.type === "text" && !node.data.trim()).remove();
        $("head").children().each((_, node) => $(node).before("\n  "));
        $("head").append("\n");
        translate($, catalog);
        setSiteLinks($, locale);
        addMetadata($, page, language, catalog);
        addPicker($, page, locale, language, catalog);
        if (locale) await mkdir(new URL(`${locale}/`, root), {recursive: true});
        const notice = locale ? "<!-- Generated by scripts/build-site.mjs. Edit the root HTML templates or messages.js. -->\n" : "";
        const markup = $.html()
            .replace(/<!DOCTYPE html>\s*/i, `<!doctype html>\n${notice}`)
            .replace(/>\s*(?=<head>|<body>|<\/html>)/g, ">\n");
        await writeFile(new URL((locale ? `${locale}/` : "") + config.file, root), markup.trimEnd() + "\n");
    }
}

const urls = Object.keys(pages).flatMap(page => locales.map(locale => new URL(pagePath(page, locale), site).href));
const sitemap = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(url => `  <url><loc>${url}</loc></url>`), "</urlset>", ""].join("\n");
await writeFile(new URL("sitemap.xml", root), sitemap);
