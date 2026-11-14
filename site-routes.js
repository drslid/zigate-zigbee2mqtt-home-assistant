export const languages = {
    en: ["English", "gb", "en_GB"],
    fr: ["Français", "fr", "fr_FR"],
    es: ["Español", "es", "es_ES"],
    it: ["Italiano", "it", "it_IT"],
    pt: ["Português", "pt", "pt_PT"],
    de: ["Deutsch", "de", "de_DE"],
};

export const pages = {
    dashboard: {file: "index.html", path: "", title: "pageTitle", description: "pageDescription"},
    drivers: {file: "pilotes.html", path: "pilotes.html", title: "driversPageTitle", description: "driversDescription"},
};

export function pagePath(page, language) {
    return language ? `${language}/${pages[page].path}` : pages[page].path;
}
