# Générer les pages GitHub Pages

Les fichiers `index.html` et `pilotes.html` à la racine servent de modèles et de points d’entrée avec détection automatique de la langue. Les traductions sont dans `messages.js`.

Après avoir modifié un modèle, une traduction ou les URL dans `site-routes.js`, lance ces commandes à la racine du dépôt avec Node.js 22.

```sh
npm ci --prefix scripts
npm run build --prefix scripts
```

Ajoute les fichiers HTML et `sitemap.xml` régénérés au commit. GitHub Pages les publie depuis `main`.
