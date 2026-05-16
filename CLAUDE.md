# Montebello DAE / EMCS Converter — Outil utilitaire douane

> Convertit les factures Akanea (XML) en JSON Douane GAMMA2 (DTI+) et en XML Akanea enrichi.
> Outil de la Suite Montebello, accessible depuis le Portail.
> Dernière mise à jour de ce document : 2026-05-16

---

## 1. Vue d'ensemble

- **Version** : **v1.0**
- **URL prod** : https://montebello-dae-converter.vercel.app
- **Repo** : https://github.com/samuelcerol-smtwve/montebello-dae-converter (public)
- **Rôle** : transformer une facture Akanea en déclaration DAE/EMCS exploitable côté Douane
- **Particularité** : 100% client-side. **PAS de Supabase, PAS d'auth PIN, PAS de backend.** Préférences en `localStorage` uniquement. Accès libre.

## 2. Stack technique

| Couche | Techno |
|--------|--------|
| Frontend | React 18.3 (1 fichier : `src/App.jsx` ~1900 lignes) |
| Build | Vite 5.3 |
| Styles | Tailwind CSS 3.4 |
| Persistance | `localStorage` (valeurs par défaut expéditeur/transporteur/véhicule) |
| Auth / BDD | Aucune |

> Contrainte : JSX pur (pas de TypeScript), Vite 5 + React 18 + Tailwind 3. **`App.jsx` est livré tel quel — testé contre la Douane GAMMA2, ne pas modifier la logique métier.**

---

## 3. Structure des fichiers

```
montebello-dae-converter/
├── CLAUDE.md                       # CE FICHIER
├── README.md                       # Doc utilisateur
├── package.json                    # React 18.3, Vite 5.3
├── vite.config.js                  # Plugin React standard
├── tailwind.config.js
├── postcss.config.js
├── index.html
├── .gitignore
└── src/
    ├── main.jsx                    # Bootstrap React (StrictMode)
    ├── index.css                   # Directives Tailwind
    └── App.jsx                     # ~1900 lignes — toute l'app
```

---

## 4. Flux applicatif (4 écrans)

```
EcranImport (import XML Akanea OU saisie manuelle)
   ↓ parserXmlAkanea()
EcranEnrichissement (complétion des données : destination, transport, poids)
   ↓ validerData()
EcranExport (génération + téléchargement)
   ├→ genererJsonDouane()  → JSON GAMMA2 DTI+
   └→ genererXmlAkanea()   → XML Akanea enrichi
```

Routage par état interne (variable `etape` dans `App()`), pas de React Router.
`ModaleParametres` accessible partout pour éditer les défauts `localStorage`.

---

## 5. Composants principaux (src/App.jsx)

| Composant | Ligne ~ | Rôle |
|-----------|---------|------|
| **App** | 1847 | Conteneur, gestion `etape` + `data` |
| **Header** | 782 | Barre de progression des 4 étapes |
| **EcranImport** | 814 | Import XML Akanea ou saisie manuelle |
| **EcranEnrichissement** | 1410 | Complétion destination/transport/poids |
| **EcranExport** | 1637 | Génération et téléchargement des fichiers |
| **Section / Champ** | 975 / 993 | Briques de formulaire réutilisables |
| **LigneProduit** | 1027 | Une ligne de produit (CN code, conditionnement) |
| **ModulePoids** | 1131 | Calcul poids net/brut guidé |
| **ModaleParametres** | 1783 | Édition des défauts `localStorage` |

## 6. Logique métier (fonctions pures)

| Fonction | Ligne ~ | Rôle |
|----------|---------|------|
| `calculerDensite(degre)` | 102 | Densité alcool selon degré |
| `calculerPoidsNet(volume, degre)` | 109 | Poids net physique |
| `calculerPoidsBrut(poidsNet, contenants)` | 117 | Poids brut (tares par contenant) |
| `detecterConditionnement(description)` | 132 | Détecte le conditionnement depuis le libellé |
| `parserXmlAkanea(xmlString)` | 194 | Parse le XML Akanea importé |
| `genererJsonDouane(data)` | 361 | Produit le JSON GAMMA2 DTI+ |
| `genererXmlAkanea(data)` | 515 | Produit le XML Akanea enrichi |
| `validerData(data)` | 649 | Validation avant export |
| `chargerDefauts` / `sauvegarderDefauts` | 765 / 774 | Lecture/écriture `localStorage` |

## 7. Constantes de référence

`COULEURS`, `PAYS_UE`, `DESTINATION_TYPES`, `MODES_TRANSPORT`, `CN_CODES`,
`KINDS_OF_PACKAGES`, `CONTENANTS_INITIAUX`, `DEFAUTS_INITIAUX` — toutes en dur en haut de `App.jsx`.
4 cas gérés : Local/Export × Bouteilles/Vrac.

---

## 8. Déploiement

- Déploiement via **`vercel --prod`** depuis le dossier du projet
- Repo GitHub **connecté** (Vercel détecte Vite automatiquement)
- **Aucune variable d'environnement** nécessaire
- Alias prod : `montebello-dae-converter.vercel.app`

```bash
npm install
npm run dev        # http://localhost:5173 (ou port libre suivant)
npm run build
vercel --prod
```

---

## 9. Intégration au Portail Montebello

- Carte ajoutée dans `montebello-portail/src/App.jsx` → constante `APPS` :
  `{ id:"dae-converter", name:"DAE / EMCS Converter", desc:"Akanea XML → JSON Douane GAMMA2 · XML Akanea enrichi", color:"#FCA5A5", url:"https://montebello-dae-converter.vercel.app", roles:[], public:true }`
- **Flag `public:true`** → accès libre, le filtre `userApps = APPS.filter(a => a.public || appDroits[a.id])` l'affiche sans droit ni rôle
- Ouverture en nouvel onglet : `window.open(url,"_blank","noopener,noreferrer")`
- Icône SVG dans `APP_ICONS["dae-converter"]` (document + flèche, style line-art cohérent)
- ⚠️ La carte n'apparaît qu'**après login PIN** (zone `Portal` du Portail). L'app DAE elle-même reste sans auth.

---

## 10. Pièges connus

1. **`App.jsx` figé** : logique testée contre la Douane GAMMA2 — ne pas toucher au métier sans revalidation douane.
2. **Pas de persistance serveur** : tout est en mémoire/`localStorage`. Un refresh en cours de saisie perd les données non exportées.
3. **Le Portail ne s'auto-déploie pas depuis GitHub** : après modif du Portail, faire `git push` ET `vercel --prod` (voir CLAUDE.md du Portail).
4. **Ports de dev** : `5173` souvent occupé par les autres apps Montebello → Vite bascule automatiquement (5174, 5175…).

## 11. Liens

- **App** : https://montebello-dae-converter.vercel.app
- **Repo** : https://github.com/samuelcerol-smtwve/montebello-dae-converter
- **Portail** : https://montebello-portail.vercel.app
