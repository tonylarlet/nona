# Nona

Application web de prise de notes avec:

- classement par thème
- rattachement à une société
- propositions de questions de relance
- mode IA via OpenAI
- base de sociétés chargée depuis `companies.json`

## Utilisation locale

1. Ouvrir `notes-assistant.html` dans le navigateur, ou mieux lancer un petit serveur local.
2. Renseigner l'URL du backend IA, par exemple `http://localhost:8787`.
3. Renseigner la clé OpenAI dans l'interface, ou mieux dans le backend.

## Lancer le backend IA

Le backend est un simple serveur Node sans dépendance externe.

Variables d'environnement:

- `OPENAI_API_KEY`
- `OPENAI_MODEL` optionnel, défaut `gpt-4.1-mini`
- `PORT` optionnel, défaut `8787`

Commande:

```bash
node server.js
```

## GitHub Pages

Oui, l'interface peut être mise sur GitHub Pages.

Recommandation:

- publier seulement la partie front-end
- garder le backend IA ailleurs, par exemple sur un petit serveur interne, Azure, Render, Railway, ou une fonction serverless
- pointer le champ `URL du backend IA` vers ce backend

## Fichiers

- `notes-assistant.html`: interface principale
- `companies.json`: liste des sociétés
- `server.js`: proxy IA OpenAI
