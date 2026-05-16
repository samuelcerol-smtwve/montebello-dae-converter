# Montebello — DAE / EMCS Converter

Outil de conversion des factures Akanea en JSON Douane GAMMA2 et XML Akanea enrichi.

## Fonctionnalités

- Import XML Akanea ou saisie manuelle
- Détection automatique des 4 cas (Local/Export × Bouteilles/Vrac)
- Conversion LAP → volume réel guidée
- Calculateur de poids physique (densité selon degré, tares par contenant)
- Export JSON Douane conforme GAMMA2 DTI+
- Export XML Akanea enrichi

## Stack

- Vite + React 18
- Tailwind CSS
- localStorage pour les valeurs par défaut (expéditeur, transporteur, véhicule)
- Pas de base de données, pas d'authentification

## Installation locale

```bash
npm install
npm run dev
```

L'app sera accessible sur http://localhost:5173

## Déploiement Vercel

1. Pousser sur GitHub (repo public ou privé)
2. Connecter le repo sur Vercel
3. Vercel détecte automatiquement Vite et déploie

Aucune variable d'environnement nécessaire.

## Structure des fichiers

```
montebello-dae-converter/
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
└── src/
    ├── main.jsx
    ├── index.css
    └── App.jsx
```

## Intégration dans le Portail Montebello

Ajouter une carte dans le Portail pointant vers l'URL Vercel du déploiement.
Pas d'authentification, accès libre.
