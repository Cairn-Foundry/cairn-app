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

Raccourcis à déclarer dans `SHORTCUT_DEFS` (groupe `editor`) : `goToDefinition` (F12),
`findReferences` (Maj+F12), `renameSymbol` (F2), `formatDocument`.

## 4. Proposition d'activation à l'ouverture

À l'ouverture d'un onglet, si l'extension du fichier correspond à un serveur du
catalogue qui n'est ni activé ni écarté, et que `suggestLanguageServers` est vrai,
une barre discrète s'affiche au-dessus de l'éditeur :

> Fichier Python détecté. Activer Pyright ? **Activer** · Pas maintenant · Ne plus proposer

"Activer" installe rien : si le binaire est absent, la carte de la page Serveurs de
langage s'ouvre avec la commande d'installation. Cairn ne lance jamais une
installation dans le dos de l'utilisateur.

## 5. Phasage

Chaque phase est livrable et perceptible seule.

| Phase | Contenu | Livrable perçu |
| --- | --- | --- |
| 1 | Transport, cycle de vie, catalogue, détection binaires, réglages, page d'accueil | On voit et on active ses langages |
| 2 | Synchro documents + diagnostics dans l'éditeur | Les erreurs s'affichent en direct |
| 3 | Complétion, hover, signature help | L'autocomplétion réelle |
| 4 | Définition, **références / implémentations**, symboles du document | La demande d'origine |
| 5 | Proposition à l'ouverture, rename, formatage | Le confort |

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
