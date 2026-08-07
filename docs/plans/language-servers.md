# Plan - Serveurs de langage (LSP)

## Objectif

Donner à l'éditeur de Cairn ce qui lui manque pour remplacer un IDE au quotidien :
complétion réelle, diagnostics, aller à la définition et **recherche des
implémentations / usages d'un symbole**. Le tout branché sur de vrais serveurs de
langage (LSP), activables par l'utilisateur depuis une page d'accueil dédiée, et
proposés automatiquement quand un fichier d'un langage non configuré est ouvert.

La demande d'origine était la recherche d'usages. Elle est traitée ici comme une
conséquence du socle LSP plutôt que comme une recherche textuelle heuristique : une
recherche par mot entier confond un appel, une définition, un commentaire et une
chaîne de caractères, et se trompe dès qu'un nom est porté par deux symboles
différents. Le LSP répond exactement, et le même socle sert la complétion, le hover
et les diagnostics.

## 0. Ce que le nom "langage" recouvre

L'onglet de réglages `languages` existe déjà et désigne **la langue de l'interface**
(i18n). La nouvelle surface s'appelle donc **Serveurs de langage** /
*Language servers*, section d'accueil `languageServers`, jamais `languages`.

Un point de vocabulaire à tenir dans l'UI : React n'est pas un serveur de langage.
C'est `typescript-language-server` sur des fichiers `.tsx` / `.jsx`. La page liste des
serveurs, et indique pour chacun les extensions couvertes, pour que
"j'ai besoin de React" trouve sa réponse sans chercher.

## 1. Modèle de données

### Catalogue (en dur, versionné avec l'app)

```ts
interface LanguageServerDef {
  id: string;                    // "typescript", "python", "rust"...
  name: string;                  // "TypeScript / JavaScript"
  binary: string;                // "typescript-language-server"
  args: string[];                // ["--stdio"]
  languageIds: string[];         // ids LSP: "typescript", "typescriptreact"...
  extensions: string[];          // [".ts", ".tsx", ".js", ".jsx"]
  rootMarkers: string[];         // ["tsconfig.json", "package.json"]
  install: { npm?: string; brew?: string; cargo?: string; pip?: string; url: string };
}
```

Miroir Rust dans `registry.rs`, miroir TS dans `src/lib/utils/languages/servers.ts`,
tenus en phase comme le sont déjà `default_workflow_tabs` et `DEFAULT_WF_TABS`.

Premier lot : TypeScript/JavaScript (+ React), Python (Pyright), Rust
(rust-analyzer), Go (gopls), Svelte, JSON / CSS / HTML, YAML, Bash. C/C++ (clangd) et
Vue (Volar) en second lot.

### Réglages (`CairnSettings`, Rust + TS)

```ts
interface LanguageServerSetting {
  id: string;
  enabled: boolean;
  command: string;   // override du binaire, vide = celui du catalogue
  args: string[];    // override, vide = ceux du catalogue
}

languageServers: LanguageServerSetting[];
suggestLanguageServers: boolean;          // proposer a l'ouverture d'un fichier
dismissedLanguageServers: string[];       // "ne plus proposer" par serveur
```

### État runtime (Rust, non persisté)

```rust
struct ServerKey { server_id: String, root: PathBuf }   // un serveur par racine
struct ServerHandle {
    child: Child,
    pending: Mutex<HashMap<i64, Sender<Value>>>,        // requetes en vol
    open_docs: Mutex<HashMap<PathBuf, i32>>,            // uri -> version
    status: ServerStatus,                               // starting|ready|failed|stopped
}
struct LspState { servers: Mutex<HashMap<ServerKey, ServerHandle>> }
```

## 2. Backend Rust

Nouveau domaine `src-tauri/src/commands/lsp/` :

- `client.rs` - transport JSON-RPC sur stdio : cadrage `Content-Length`, un thread
  lecteur `stdout` qui résout les requêtes en attente et transforme les notifications
  en events Tauri, un thread `stderr` pour les logs.
- `server.rs` - cycle de vie : `spawn`, `initialize` / `initialized`, `shutdown` /
  `exit`, redémarrage borné (3 tentatives, puis statut `failed`).
- `registry.rs` - le catalogue et la résolution du binaire (PATH, puis chemins
  usuels : `node_modules/.bin`, `~/.cargo/bin`, `~/.local/bin`, Homebrew).
- `mod.rs` - `LspState` et les commandes.

Les structures du protocole viennent de la crate `lsp-types` plutôt que d'être
retapées ; le transport reste en `serde_json::Value`.

**Toutes les commandes sont `pub async fn`.** Un `initialize` de rust-analyzer sur un
gros dépôt prend plusieurs secondes : une commande synchrone gèlerait la fenêtre
(règle du CLAUDE.md).

| Commande | Rôle |
| --- | --- |
| `list_language_servers` | catalogue + binaire détecté + version + statut |
| `start_language_server` / `stop_language_server` | cycle de vie explicite |
| `lsp_did_open` / `did_change` / `did_save` / `did_close` | synchro du document |
| `lsp_completion`, `lsp_hover`, `lsp_signature_help` | assistance à la frappe |
| `lsp_definition`, `lsp_references`, `lsp_implementation` | navigation |
| `lsp_document_symbols`, `lsp_rename`, `lsp_format` | le reste |

Events : `lsp-diagnostics` (uri + diagnostics), `lsp-status` (serveur, racine, état,
message d'erreur).

**Démarrage paresseux** : un serveur activé ne démarre qu'à la première ouverture
d'un fichier de son langage dans un worktree, et s'arrête quand le projet se ferme.
Cairn ne doit jamais lancer six processus au démarrage.

## 3. Frontend

- `src/lib/services/lsp-service.ts` - seule couche qui appelle `invoke`.
- `src/lib/stores/language-server.ts` - statut par serveur, diagnostics par fichier,
  abonnement aux events.
- `src/lib/utils/editor/editor-lsp.ts` - les extensions CodeMirror : source
  d'autocomplétion asynchrone, `hoverTooltip`, `setDiagnostics` via
  `@codemirror/lint`, signature help. La synchro du document se branche sur le cycle
  de vie des onglets de `FilesView` (ouverture, frappe débattue, sauvegarde,
  fermeture).
- `src/lib/components/files/ReferencesPanel.svelte` - le panneau de résultats, calqué
  sur `SearchPanel.svelte` (même largeur, même regroupement par fichier), avec trois
  sections : Définitions, Implémentations, Usages.
- `src/lib/components/home/LanguageServersSection.svelte` - la page d'accueil : une
  carte par serveur (nom, extensions couvertes, statut, chemin détecté, toggle) et,
  quand le binaire est absent, la commande d'installation avec un `CopyButton`.

Raccourcis à déclarer dans `SHORTCUT_DEFS` (groupe `editor`) : `goToDefinition`
(Maj-clic), `findReferences` (Ctrl-Maj-clic), `renameSymbol` (F2), `formatDocument`.

## 4. Proposition d'activation à l'ouverture

À l'ouverture d'un onglet, si l'extension du fichier correspond à un serveur du
catalogue qui n'est ni activé ni écarté, et que `suggestLanguageServers` est vrai,
une carte discrète s'affiche en bas à droite de la fenêtre :

> Fichier Python détecté. Activer Pyright ? **Activer** - Pas maintenant - Ne plus proposer

Elle attend une réponse plutôt que de disparaître au bout d'un délai : une
proposition qui s'efface toute seule est une proposition que l'utilisateur n'a
jamais eu l'occasion de prendre.

"Activer" installe rien : si le binaire est absent, la carte de la page Serveurs de
langage s'ouvre avec la commande d'installation. Cairn ne lance jamais une
installation dans le dos de l'utilisateur.

## 5. Phasage

Chaque phase est livrable et perceptible seule.

| Phase | Contenu | Livrable perçu | État |
| --- | --- | --- | --- |
| 1 | Transport, cycle de vie, catalogue, détection binaires, réglages, page d'accueil | On voit et on active ses langages | livré (0.13.0) |
| 2 | Synchro documents + diagnostics dans l'éditeur | Les erreurs s'affichent en direct | livré (0.13.0) |
| 3 | Complétion, hover, signature help | L'autocomplétion réelle | livré (0.13.0) |
| 4 | Définition, **références / implémentations**, symboles du document | La demande d'origine | livré (0.13.0) |
| 5 | Proposition à l'ouverture, rename, formatage | Le confort | livré (0.13.0) |
| 6 | Second lot de langages, serveurs importés par l'utilisateur | Chacun ses langages | livré (0.13.0) |

### Ce que l'implémentation a fixé

- Le panneau **Références** est une colonne de 280 px à côté de l'arborescence, comme
  `SearchPanel`, et non une vue plein cadre. Son ouverture est malgré tout persistée
  par les quatre couches (`referencesPanelOpen`).
- Les commandes de cycle de vie sont `start_language_server` (idempotente, elle résout
  la racine et répond avec elle), `stop_language_server` et `stop_language_servers_for`,
  appelée à la fermeture d'un projet pour chaque worktree de ses instances.
- Navigation et rename sont normalisés côté Rust : `definition` / `references` /
  `implementation` répondent une liste plate de chemins et de positions quelle que
  soit la forme reçue (`Location`, `Location[]`, `LocationLink[]`), et `rename` répond
  une liste d'éditions par fichier. Le frontend ne décode jamais d'URI.
- Les surcharges `command` / `args` existent dans les réglages et sont respectées au
  démarrage, mais n'ont pas d'interface : elles se posent dans `settings.json`.
- La page Serveurs de langage a un champ de recherche : le nom, les extensions
  couvertes (avec ou sans le point) et les mots que l'utilisateur emploie à la
  place du nom du serveur - "react" trouve TypeScript, "sass" trouve CSS. Ces
  alias vivent dans `LANGUAGE_SERVERS` (`utils/languages/servers.ts`) ; ils ne
  servent qu'à la recherche et n'ont pas de miroir Rust.
- Un renommage n'écrit sur le disque que les fichiers qu'aucun onglet ne montre.
  Un onglet ouvert est modifié en mémoire et laissé modifié : le serveur a
  calculé ses éditions sur le tampon, les appliquer au contenu du disque
  écraserait un travail non enregistré.
- Les résultats du panneau Références portent leur ligne de code, lue côté Rust
  et renvoyée avec chaque position (`text`). Une liste de numéros de ligne ne dit
  pas quel usage est lequel.
- La synchronisation d'un document est indexée par **le fichier**, jamais par le
  volet qui l'affiche : un volet change de document pendant qu'un serveur démarre
  encore, et un `didChange` attribué à l'emplacement plutôt qu'au fichier atterrit
  dans le mauvais tampon. `lspDocs[i]` est donc vidé avant l'`await`, et les
  notifications passent par `openLspDocs`, clé chemin absolu.
- Navigation à la souris : `goToDefinition` et `findReferences` ne sont pas des
  raccourcis clavier mais des clics - Maj-clic et Ctrl-Maj-clic - réattribuables
  comme les autres, avec la touche `Click`. Maintenir les modificateurs souligne
  le mot sous le pointeur.
- Le panneau Références retient sa dernière recherche (`referencesQuery`, JSON
  aplati pour rester comparable par `===` dans l'état de projet) et la repose au
  rechargement comme au redémarrage, sans exiger que le fichier visé soit ouvert.
- Le second lot est allé plus loin que C/C++ (clangd) et Vue (Volar) : PHP
  (Intelephense), Ruby (Solargraph), Java (Eclipse JDT), Lua, Zig (zls), TOML
  (Taplo), Terraform, Markdown (Marksman) et GraphQL sont au catalogue. Ruby a
  amené `gem` dans `ManagerCommands` ; `owning_manager` le teste **avant**
  Homebrew, parce qu'un répertoire de gems vit souvent sous un préfixe Homebrew.
- Un serveur n'a d'entrée au catalogue que s'il s'installe **et** se retire par
  une commande : Docker et Swift en sont donc restés dehors, faute d'extension
  qui les déclenche pour l'un et de commande d'installation pour l'autre.

### Mise à jour d'un serveur

- `ManagerCommands` porte un troisième jeu, `update`, à côté de `install` et
  `uninstall`. Une mise à jour n'est **pas** une réinstallation : `brew install`
  sur une formule périmée répond qu'elle est déjà là et ne fait rien, `pip`
  réclame `--upgrade`, `cargo install` réclame `--force`. Deux tests tiennent la
  règle : tout serveur installable est aussi actualisable **par les mêmes
  gestionnaires**, et une commande `brew` d'update commence par `brew upgrade`.
- **Chercher les mises à jour** est une action explicite, jamais automatique :
  un processus et un aller-retour réseau par serveur installé. Un quatrième jeu
  de commandes, `check`, répond soit par une version (`npm view`, `gem list -r`,
  `cargo search`, `go list -m`), soit par un simple "périmé ou non" pour
  Homebrew, qui ne publie pas de version à demander. `answers_with_a_flag`
  distingue les deux familles.
- `brew outdated --quiet <formule>` écrit le nom sur stdout quand il y a quelque
  chose à faire, rien du tout sinon, et rien non plus quand la formule est
  inconnue - en sortant alors en erreur. La lecture est donc : nom écrit =
  périmé, rien + succès = à jour, rien + échec = **inconnu**. Un état qui n'a pas
  pu être établi n'est jamais affiché comme "à jour" ; la carte se tait.
- Le verdict n'est **pas persisté**. Relu depuis le disque, il affirmerait
  quelque chose sur un registre que personne n'a interrogé depuis. Il vit dans
  le store, le temps de la session, et une mise à jour réussie efface celui du
  serveur concerné - il décrit la version qui vient d'être remplacée.
- La version installée ne vient pas toujours d'un `--version` : `pyright-langserver`
  refuse de démarrer sans transport et les serveurs `vscode-*` plantent. Quand le
  binaire appartient à un paquet npm, elle est lue dans son `package.json` - plus
  exacte, et sans lancer de processus. Le paquet retenu est celui où le binaire
  se trouve, jamais l'une de ses dépendances.
- `owning_manager` **suit le lien** avant de conclure : ce que npm installe
  globalement est un lien dans un `bin` pointant vers `lib/node_modules`, et ce
  que pose Homebrew un lien vers `Cellar` - le lien seul ne nomme personne, et
  l'ancienne lecture faisait interroger le mauvais gestionnaire. `Cellar` passe
  avant `node_modules` : une formule Homebrew dont la charge utile est un paquet
  node appartient à Homebrew.
- La comparaison ne porte que sur le **noyau numérique** de la version
  (`is_newer`) : un suffixe de pré-version ne se compare pas de façon sûre, et
  annoncer une mise à jour sur cette base serait une supposition. Si l'un des
  deux côtés est illisible - un binaire muet sur `--version` -, l'état reste
  inconnu, mais la version publiée est tout de même affichée.
- Le serveur est **arrêté avant** la mise à jour : le binaire qu'un processus
  est en train d'exécuter est remplacé sous lui, et ce qu'il continue de servir
  ensuite n'engage personne. Le fichier suivant relance la nouvelle version.
- Le gestionnaire est choisi comme pour la désinstallation - celui dont le
  binaire porte l'empreinte (`owning_manager`), sinon le premier disponible.

### Plateformes

- **Windows** : un binaire n'y porte pas le nom qu'on tape. `npm` sur le disque
  est `npm.cmd`, `typescript-language-server` est `typescript-language-server.cmd`.
  Joindre le nom nu à un répertoire ne trouvait donc rien, et *tous* les serveurs
  installés par npm s'affichaient comme absents. `resolve_binary` essaie
  maintenant chaque suffixe de `PATHEXT`, et cherche aussi dans les répertoires
  de npm (`AppData\Roaming\npm`), winget et scoop, qui n'entrent dans le PATH
  d'un processus lancé depuis le menu Démarrer qu'après une reconnexion.
- **Un gestionnaire qui ne peut pas exister ici n'est plus proposé** :
  `runs_here` écarte Homebrew sous Windows, dans les options affichées comme
  dans ce que `resolve_command` accepte de lancer. Une carte sans gestionnaire
  disponible retombe sur le lien de documentation - un état normal, pas une
  erreur. Le filtre porte sur `manager_options` et `resolve_command`
  uniquement : `shares_removal_with` compare les commandes du catalogue et doit
  répondre pareil partout.
- Rien n'a été ajouté qui réclame `sudo` (`apt`, `dnf`, `pacman`) : la commande
  tourne dans un shell sans terminal, une invite de mot de passe s'y bloquerait
  sans que l'utilisateur puisse rien y faire. Les gestionnaires du catalogue
  sont donc soit multiplateformes et par utilisateur (npm, pip, cargo, go, gem),
  soit Homebrew, explicitement limité à macOS et Linux.

### Serveurs importés par l'utilisateur

- `LanguageServerDef` n'est plus `&'static` : il est possédé (`String`,
  `Vec<String>`), construit à la volée par `catalog()` = `BUILTIN` +
  `custom_defs()`. Le catalogue est relu à chaque appel, pour qu'un serveur
  ajouté réponde au scan suivant et non au prochain démarrage.
- La déclaration vit dans les réglages (`customLanguageServers`), pas dans un
  fichier à part : c'est un réglage, il se sauvegarde et se synchronise comme
  les autres, et les surcharges `command` / `args` déjà en place continuent de
  s'appliquer par-dessus.
- Un serveur dont l'id est déjà celui d'un serveur du catalogue est **écarté**,
  des deux côtés (`custom_defs` en Rust, `setCustomServers` en TS). Un id qui en
  masque un autre donne un serveur que personne ne peut démarrer.
- En revanche, une **extension** déjà couverte revient au serveur de
  l'utilisateur : c'est ainsi qu'on remplace un serveur du catalogue dont on ne
  veut pas. `serverForPath` et `languageIdForPath` consultent donc les serveurs
  de l'utilisateur en premier.
- Les fonctions de résolution sont pures et sans store ; les serveurs déclarés
  leur sont poussés par un `subscribe` de `stores/settings.ts`, parce qu'un
  fichier s'ouvre bien avant que la page Serveurs de langage n'ait été affichée.
- Cairn n'installe, ne met à jour ni ne supprime un serveur qu'il n'a pas posé :
  sa carte n'offre ni installation ni désinstallation, seulement la modification
  de la déclaration, son retrait, et le constat que la commande est introuvable.
  Le retirer emporte son drapeau `enabled`, pour qu'un id réutilisé plus tard ne
  revienne pas mystérieusement activé.

## 6. Points de vigilance

- **Ne jamais bloquer l'UI** : commandes `async`, timeout par requête, un serveur muet
  dégrade l'éditeur sans le figer.
- **Binaire absent** : statut explicite, aucune tentative de spawn, aucune erreur
  rouge - c'est un état normal tant que l'utilisateur n'a rien installé.
- **Un serveur par racine de workspace**, partagé entre les instances d'un même
  projet quand elles pointent la même racine, sinon un par worktree.
- **`didChange` débattu** (~300 ms) : à chaque frappe, c'est un serveur saturé.
- **Persistance de vue** : le panneau Références est une vue qui prend la zone
  principale, donc les quatre couches de la règle "toute vue survit à un redémarrage"
  s'appliquent (store `ui.ts`, `ProjectUiState` TS, `view-state.ts`, `ProjectUiState`
  Rust).
- **Changelog** : une ligne par phase livrée, en `en` et `fr`.
