# Cairn — IDE nouvelle génération
> Document de travail — Benjamin Bonneton

---

## Vision

Un environnement de développement centré sur le workflow réel du développeur augmenté par l'IA : **l'humain supervise, l'agent produit**. Le code devient une vue secondaire, et les outils du quotidien (agent, Git, tests, CI/CD) deviennent les espaces principaux.

L'objectif est de remplacer VS Code non pas par un meilleur éditeur de texte, mais par un **environnement orienté intentions et résultats**.

---

## Principes fondateurs

- **Légèreté avant tout** — empreinte RAM et disque minimale. Tauri (Rust + WebView native) comme stack desktop.
- **Partir de zéro** — pas de dépendance à Monaco, CodeMirror ou autre éditeur existant.
- **Batteries incluses** — les fonctionnalités des grandes extensions VS Code sont intégrées nativement (Prettier, ESLint/Biome, support des langages...). Pas de marketplace, pas d'extensions.
- **Abstraction du moteur IA** — l'UI ne connaît jamais le fournisseur IA. Un Agent Bridge reçoit des intentions, un Driver les traduit vers Claude Code CLI (ou autre demain).
- **Offline first** — l'app fonctionne sans connexion. Seules les features IA nécessitent le réseau.
- **Outil individuel** — usage solo, installé sur le poste de l'utilisateur.

---

## Stack technique

| Composant | Choix |
|---|---|
| Framework desktop | Tauri (Rust + WebView système) |
| UI | À définir (React / Svelte dans la WebView) |
| Coloration syntaxique | Tree-sitter |
| Formatage | Prettier intégré |
| Linting | ESLint / Biome intégré |
| Moteur IA v1 | Claude Code CLI (via Agent Bridge) |
| Git | git CLI natif via commandes système |

---

## Concept central — Instance de Projet

L'unité de travail n'est pas un fichier, c'est une **tâche** (ticket ou tâche interne).

### Workflow

```
Sélectionner ou créer un ticket (Jira / GitLab / GitHub Issues / interne)
        ↓
Créer une Instance
  → git worktree create  (branche dédiée et isolée)
  → environnement configuré (.env, config)
  → session d'agent initialisée avec le contexte du ticket
        ↓
Travailler dans l'instance
  → l'agent travaille sur cette branche isolée
  → tests, logs, CI/CD rattachés à cette instance
  → timeline enregistrée automatiquement
        ↓
Fermer l'instance
  → commit + push
  → PR/MR créée automatiquement
  → worktree nettoyé
```

### Navigation entre instances
Changer d'instance = changer de contexte complet instantanément, sans toucher à la branche principale. Comparable à changer d'onglet dans un navigateur, mais pour un projet entier.

---

## Timeline & Checkpoints

La **Timeline** est passive : elle enregistre automatiquement tout ce qui se passe dans une instance — actions de l'agent, fichiers modifiés, commits, résultats de tests, logs CI. C'est un journal de bord consultable.

Les **Checkpoints** sont des étapes marquantes sur la timeline, déclenchés manuellement avant une action risquée. Ils sauvegardent l'état complet de l'instance (état Git + état de la session agent) et permettent d'y revenir en un clic — comme un "save point".

Les deux sont unifiés dans une même vue : la timeline affiche le fil continu, les checkpoints sont des jalons visuels sur lesquels on peut se repositionner.

---

## Multi-projets

**Une fenêtre unique avec onglets de projets.**

Chaque onglet correspond à un projet ouvert (ex : `Frontend`, `Backend`, `Infra`). Les projets sont indépendants, chacun avec ses propres instances. Un écran d'accueil permet d'ouvrir, fermer et gérer les projets.

---

## Fonctionnalités détaillées

### Agent

- Session d'agent par instance de projet
- Feed d'activité en temps réel (ce que l'agent fait, fichiers touchés, décisions)
- Possibilité d'interrompre ou rediriger l'agent en cours de tâche
- Contexte du ticket injecté automatiquement dans la session
- **Profils d'agent** : préréglages d'instructions selon le contexte (`refactor`, `debug`, `documentation`, `review`...)
- **Agent Bridge** : couche d'abstraction stable entre l'UI et le moteur IA
- **Driver** : implémentation concrète (Claude Code CLI v1, extensible)

### Review & Code

- Diff viewer avec annotations IA (explication inline des changements)
- Éditeur minimaliste pour corrections manuelles ponctuelles
- Explorateur de fichiers (navigation en lecture principale)
- Recherche globale dans le projet
- Coloration syntaxique via Tree-sitter
- Autocomplétion classique (symboles du projet + contenu du fichier ouvert) — pas de complétion IA style Copilot

### Git

- État du repo en temps réel (modifiés, staged, untracked)
- Staging visuel hunk par hunk
- Commit en un clic avec message auto-généré par l'IA (éditable)
- Gestion des branches (créer, switcher, voir l'état)
- Fetch / Pull / Push en un clic
- Stash rapide
- Merge / Rebase avec aide visuelle aux conflits + résolution par l'agent
- Historique et graph des branches

### Tests & Runtime

- Runner de tests intégré, résultats en temps réel
- Raccourci direct "corriger ce test" vers l'agent sur un test en échec
- Terminal intégré (secondaire, pas central)
- Logs en temps réel (serveur de dev, build...)
- Gestion des environnements (`.env` par instance, profils dev/staging/prod)

### CI/CD & Intégrations

- État des pipelines GitLab CI / GitHub Actions en temps réel
- Logs de pipeline dans l'app
- "Corriger cette pipeline" → agent direct sur les logs d'erreur
- Intégrations tickets dès la v1 : **GitLab Issues**, **GitHub Issues**, **Jira**, tâche interne

### Dépendances & Sécurité

- Panneau de gestion des dépendances (npm, cargo, pip...)
- Voir les mises à jour disponibles
- **Audit de vulnérabilités** par dépendance avec niveau de sévérité (critique, haute, moyenne, basse)
- Lancer l'installation des dépendances sans ouvrir le terminal

### Batteries incluses (sans installation)

- **Prettier** — formatage automatique au moment du staging Git
- **ESLint / Biome** — linting intégré, configurable via fichiers standards du projet
- **Tree-sitter** — support natif de : TypeScript/JavaScript, Python, Rust, Go, PHP, SQL, JSON, YAML, TOML, Markdown
- Masquage des secrets et valeurs sensibles dans l'UI (`.env`)

---

## Ce qui est exclu (pour rester focusé)

| Feature | Statut | Raison |
|---|---|---|
| Extensions / Marketplace | ✗ Exclu | Complexité et dette. Les features utiles sont intégrées nativement. |
| LSP / autocomplétion avancée style Copilot | ✗ Exclu | L'agent écrit le code, pas l'utilisateur. |
| Debugging pas-à-pas (DAP) | ⏳ V2 | Nécessaire à terme, pas MVP. |
| Thèmes / customisation poussée | ⏳ V2 | Pas prioritaire au démarrage. |
| SSH / remote | ⏳ V2 | À évaluer selon les retours utilisateurs. |
| Multi-fenêtres | ✗ Remplacé | Remplacé par les onglets de projets. |
| Collaboration temps réel | ✗ Exclu v1 | Outil individuel pour l'instant. |

---

## Identité

- **Nom** : Cairn
- **Symbolique** : les cairns sont des empilements de pierres posés comme repères de navigation. Chaque pierre = une étape. On avance en suivant les cairns. Métaphore directe du workflow progressif de l'app.
- **Logo** : un cairn stylisé en blanc sur fond noir. Sobre, unique, reconnaissable. Pas de texte obligatoire — le pictogramme seul est suffisamment fort.
- **Identité visuelle** : minimaliste, dark, sobre. Priorité à la lisibilité et à la densité d'information utile.

---

## Navigation

### Structure générale

```
┌─────────────────────────────────────────────────────────────────┐
│  [Cairn]  Frontend ▾  |  Backend ▾  |  + Projet            [⚙] │  ← Onglets projets
├──────────┬──────────────────────────────────────────────────────┤
│          │  ● FEAT-42 · Ajouter l'auth TOTP          [▶ Lancer] │  ← Header instance
│  1       │  main → feat/totp  ·  3 fichiers modifiés  [⏸] [✓]  │
│  Agent   ├──────────────────────────────────────────────────────┤
│  ──────  │                                                       │
│  2       │                                                       │
│  Review  │         Vue principale (change selon étape)          │
│  ──────  │                                                       │
│  3       │                                                       │
│  Git     │                                                       │
│  ──────  │                                                       │
│  4       │                                                       │
│  Tests   │                                                       │
│  ──────  │                                                       │
│  5       │                                                       │
│  CI/CD   ├──────────────────────────────────────────────────────┤
│          │  Timeline  ───●────────●────────●──────▶  [+ Save]   │  ← Timeline persistante
└──────────┴──────────────────────────────────────────────────────┘
```

### Zones

**Barre d'onglets (haut)** — un onglet par projet ouvert. Permet de passer d'un projet à l'autre dans la même fenêtre sans multi-fenêtres.

**Header contextuel** — toujours visible, affiche l'instance active : nom du ticket, branche courante, état Git rapide, et les actions globales (lancer / arrêter / terminer l'instance).

**Sidebar gauche — workflow numéroté** — les 5 étapes dans l'ordre naturel du workflow. L'étape active est mise en avant. Les étapes complétées sont cochées. Les suivantes sont accessibles librement — le numérotage guide sans contraindre.

| Étape | Zone | Rôle |
|---|---|---|
| 1 | Agent | Lancer et superviser l'agent sur la tâche |
| 2 | Review | Lire et valider les changements produits |
| 3 | Git | Stager, commiter, pousser |
| 4 | Tests | Lancer les tests, corriger les échecs |
| 5 | CI/CD | Suivre la pipeline, corriger si besoin |

**Vue principale** — contenu de l'étape sélectionnée. Occupe tout l'espace central.

**Timeline (bas)** — persistante quelle que soit l'étape active. Affiche le fil de l'instance avec les checkpoints manuels. Toujours visible, jamais intrusive.

### Instances

Le switcher d'instances est accessible depuis le header contextuel. Chaque instance correspond à un ticket / une tâche et tourne sur sa propre branche Git (worktree). Changer d'instance = changer de contexte complet instantanément.
