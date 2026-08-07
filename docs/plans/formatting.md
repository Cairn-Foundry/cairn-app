# Plan - Formatage du code (V0.13.0)

## Objectif

Donner a Cairn un formatage de code natif, comparable a ce que Prettier apporte a
JavaScript, mais pour tous les langages que l'editeur supporte deja. L'utilisateur
definit un **style** une fois pour toutes, globalement, et le surcharge par langage
et par projet. Il peut importer le style d'un projet existant (`.prettierrc`,
`.editorconfig`, `rustfmt.toml`, `biome.json`, `.clang-format`, `pyproject.toml`) et
exporter le sien.

### Quel binaire tourne

Le formateur reel du projet, resolu dans cet ordre pour chaque fichier :

1. le binaire choisi pour le langage, cherche d'abord dans la toolchain du
   projet (`node_modules/.bin` pour la famille JS - un depot qui epingle
   prettier 3.2 formate avec **le sien**, pas avec un binaire global de
   passage), puis dans le `PATH` ;
2. a defaut, `textDocument/formatting` sur le serveur de langage s'il tourne
   deja pour ce langage - c'est gratuit, `lsp_format` existe ;
3. a defaut, la passe interne minimale (indentation, espaces en fin de ligne,
   newline finale), qui ne touche jamais a la structure du code et ne peut donc
   pas produire un diff que la CI du projet refuserait.

### Ce que Cairn n'ecrit pas lui-meme

Cairn **n'implemente pas** un moteur de formatage par langage : reecrire
`prettier`, `rustfmt`, `gofmt` et `clang-format` n'est pas tenable et donnerait un
resultat different de celui de la CI du projet. Cairn est la **couche unifiee**
au-dessus des formateurs reels :

- un **modele de style unique** (indentation, largeur, guillemets, virgules
  finales, fins de ligne...), edite dans une seule UI, quel que soit le langage ;
- des **adaptateurs** qui traduisent ce modele vers la configuration native de
  chaque formateur, et qui savent la relire pour importer ;
- une **execution** du formateur reel, avec repli sur `textDocument/formatting`
  du LSP (deja branche, `lsp_format`) quand aucun binaire n'est disponible.

C'est ce qui rend l'affichage honnete : le fichier sorti de Cairn est identique a
celui que produirait l'outil en ligne de commande du projet.

## 1. Modele de donnees

Le style est un dictionnaire plat d'options nommees dans le vocabulaire de Cairn,
pas dans celui d'un outil particulier.

```ts
type StyleValue = string | number | boolean;

interface StyleOptionDef {
  id: string;                       // 'indentStyle', 'lineWidth', 'quoteStyle'...
  kind: 'boolean' | 'number' | 'enum';
  choices?: string[];               // pour 'enum'
  min?: number; max?: number;       // pour 'number'
  default: StyleValue;
  /** Langages ou l'option a un sens. Vide = universelle. */
  languages: string[];
}

/** Un jeu d'options. Toute cle absente est heritee du niveau superieur. */
type StyleSet = Record<string, StyleValue>;

interface FormatterDef {
  id: string;                       // 'prettier', 'rustfmt', 'ruff', 'gofmt'...
  name: string;
  languages: string[];              // langageIds, memes ids que le LSP
  extensions: string[];
  binary: string;
  /** Options du modele que ce formateur sait honorer. */
  supported: string[];
  docUrl: string;
}

interface LanguageFormatting {
  languageId: string;
  enabled: boolean;
  formatterId: string;              // '' = repli LSP
  /** Chemin/arguments quand l'utilisateur amene son binaire. */
  command: string;
  args: string[];
  style: StyleSet;                  // surcharges du langage
}

interface FormattingConfig {
  enabled: boolean;
  formatOnSave: boolean;
  /** Si un fichier de config natif existe dans le depot, il gagne. */
  respectRepoConfig: boolean;
  base: StyleSet;                   // style commun a tous les langages
  languages: LanguageFormatting[];
}
```

Le catalogue (`FormatterDef[]` et `StyleOptionDef[]`) est **statique cote Rust**,
comme le catalogue de serveurs de langage dans `commands/lsp/registry.rs`, et
expose au front par une commande. Ajouter un formateur = une entree dans ce
catalogue, rien d'autre.

### Options du modele (v1)

Universelles : `indentStyle` (space|tab), `indentSize`, `lineWidth`,
`lineEnding` (lf|crlf|auto), `finalNewline`, `trimTrailingWhitespace`.
Langages a accolades / JS : `quoteStyle` (single|double|preserve),
`jsxQuoteStyle`, `semicolons` (always|asNeeded), `trailingComma`
(none|es5|all), `bracketSpacing`, `bracketSameLine`, `arrowParens`.
Rust : `reorderImports`, `matchBlockTrailingComma`. Python : `skipStringNormalization`.

Une option non supportee par le formateur choisi est affichee **grisee, avec la
raison**, jamais silencieusement ignoree.

### Resolution

Pour un fichier donne : `defaults du catalogue` < `base globale` <
`langage global` < `base projet` < `langage projet`, et si
`respectRepoConfig` et qu'un fichier natif est present a la racine du worktree,
c'est lui qui l'emporte entierement pour ce langage. La resolution vit dans un
module pur `src/lib/utils/formatting/resolve.ts` (teste unitairement) et est
rejouee cote Rust au moment d'ecrire la config native.

## 2. Persistance

Deux niveaux seulement, global et projet, cadres sur ce que font deja les
variables d'environnement :

```
~/.cairn/formatting.json                      # FormattingConfig globale
~/.cairn/projects/{project-id}/formatting.json # FormattingConfig du projet
```

Nouveaux helpers dans `storage.rs` : `global_formatting_file()`,
`project_formatting_file(project_id)`. Nouveau `commands/formatting.rs` avec
`get_global_formatting`, `save_global_formatting`, `get_project_formatting`,
`save_project_formatting`, `list_formatters`, `list_style_options`,
`format_document`, `import_formatting_config`, `export_formatting_config`,
`detect_repo_formatters`. Tout enregistre dans `lib.rs` et reexporte depuis
`commands/mod.rs`. `format_document` shell-out un process : **`pub async fn`**
obligatoire (cf. CLAUDE.md), sinon la fenetre gele pendant le formatage.

## 3. Execution du formatage

1. Resoudre le langage a partir de l'extension, puis le `LanguageFormatting`.
2. Si `respectRepoConfig` et fichier natif present : lancer le formateur sans
   config generee, en laissant l'outil lire celle du depot.
3. Sinon, generer la config native dans un fichier temporaire et la passer par
   le flag dedie (`--config`, `--config-path`, `--style=file:...`).
4. Lancer le binaire avec le contenu du buffer sur stdin, recuperer stdout.
   Sortie non nulle ou stderr non vide : aucun changement applique, l'erreur
   remonte a l'UI.
5. Aucun binaire trouve : repli sur `lsp_format` si un serveur du langage tourne,
   sinon repli minimal interne (indentation, espaces en fin de ligne, newline
   finale) qui ne touche jamais la structure du code.
6. Appliquer le resultat comme une transaction CodeMirror unique, en conservant
   la position du curseur (diff ligne a ligne, pas un `replace` du document).

Declencheurs : la commande `formatDocument` **qui existait deja** et ne partait
que sur le LSP - elle passe maintenant par ce chemin et ne retombe sur
`lsp_format` que si aucun binaire n'est joignable ; et le formatage a
l'enregistrement quand `formatOnSave` est actif, insere avant l'ecriture disque
dans `flushSave`. En vue scindee, seul le panneau qui a le focus est formate :
`runFormatDocument` agit sur lui, et formater l'autre depuis la lui appliquerait
son texte.

## 4. Import / export

**Import** - `import_formatting_config` prend un chemin et devine le format :

| Fichier                                     | Lu vers                          |
| ------------------------------------------- | -------------------------------- |
| `.prettierrc`, `.prettierrc.json`, `.prettierrc.yaml`, cle `prettier` de `package.json` | style JS/TS/CSS/HTML/MD |
| `.editorconfig`                             | options universelles, par glob   |
| `biome.json`                                | style JS/TS/JSON                 |
| `rustfmt.toml` / `.rustfmt.toml`            | style Rust                       |
| `pyproject.toml` (`[tool.black]`, `[tool.ruff]`) | style Python                |
| `.clang-format`                             | style C/C++/ObjC                 |
| `.cairnformat`                              | `FormattingConfig` complet       |

Le parsing renvoie un **rapport** : options reconnues et mappees, options
reconnues mais sans equivalent dans le modele, options inconnues. L'UI le montre
avant d'appliquer - un import silencieux qui perd la moitie du fichier est pire
que pas d'import du tout. Un bouton "detecter" (`detect_repo_formatters`)
parcourt la racine du worktree et propose ce qu'il trouve a l'ouverture d'un
projet dont le formatage n'est pas encore configure.

**Export** - `.cairnformat` (le modele tel quel, reimportable), ou export
vers un format natif (`.prettierrc`, `rustfmt.toml`, ...) pour poser dans le
depot ce que Cairn applique, afin que la CI et l'editeur soient d'accord. Les
options que le format cible ne sait pas exprimer sont listees dans le retour.

Import et export passent par `plugin-dialog`, deja utilise ailleurs.

## 5. UI

**Global** : nouvelle section d'accueil `formatting` (**Formatage** /
*Formatting*), au meme rang que Serveurs de langage, avec sa cle dans
`HomeSidebar.svelte`. Colonne gauche : la liste des langages, chacun avec son
formateur et une pastille d'etat (binaire trouve / absent / repli LSP). Colonne
droite : le style, en deux blocs - **Commun** (les options universelles) et
**Specifique au langage**. Chaque champ herite affiche sa valeur heritee en
placeholder et un bouton de reinitialisation quand il est surcharge, pour que
"d'ou vient cette valeur" reste lisible sans quitter l'ecran.

**Projet** : un **outil**, exactement comme les variables d'environnement, et pas
un onglet des reglages - c'est une vue de travail liee au projet ouvert, pas une
preference d'application. Concretement :

- une entree `{ id: 'formatting', icon: 'wand', name: 'tools.formattingName',
  description: 'tools.formattingDescription' }` dans le tableau `TOOLS` de
  `ToolsPanel.svelte` ;
- un `case 'formatting'` dans `selectTool()` de `Workspace.svelte`, et une
  action `openFormatting` dans `APP_ACTIONS` avec son `ShortcutId`, sa def et
  ses cles `shortcuts.defs.*`, sur le modele de `openEnv` ;
- une vue `src/lib/components/formatting/FormattingView.svelte`, calquee sur
  `EnvView.svelte`, qui reutilise le meme composant d'edition de style que la
  section d'accueil, avec un en-tete rappelant que tout ce qui n'est pas
  surcharge vient du global, et l'interrupteur `respectRepoConfig`.

La vue prend la zone principale : elle doit donc **survivre a un redemarrage sur
elle-meme**, ce qui veut dire les quatre couches, toutes (cf. CLAUDE.md) - le
drapeau dans `stores/ui.ts`, le champ sur `ProjectUiState` dans
`services/ui-state-service.ts`, le snapshot et la restauration dans
`stores/view-state.ts`, et le champ `#[serde(default)]` sur le `ProjectUiState`
Rust avec son `subscribe(() => persistUiState())` dans `+page.svelte`.

Detection de binaire et formatage sont asynchrones : `Spinner.svelte` inline sur
la ligne du langage, jamais de texte "Chargement...". Les chemins de binaire et
les noms de fichiers de config sont `class="selectable"` avec un
`CopyButton.svelte`. Nouvelles cles i18n sous `formatting.*` dans `en.ts` et
`fr.ts`.

Quatre points que l'usage a rendus obligatoires :

- **Le depot qui gagne doit se voir.** Quand `respectRepoConfig` est actif et
  qu'un fichier natif du formateur est present, les champs de style ne decident
  plus rien. Un bandeau le dit, nomme le fichier, et offre les deux seules
  sorties utiles - l'importer, ou passer a son propre style ; les groupes
  d'options passent en `.inert`. Sans cela l'utilisateur regle des controles
  morts.
- **Les langages portent leur nom.** Les ids viennent du vocabulaire LSP
  (`javascriptreact`, `objective-cpp`) : `utils/formatting/languages.ts` les
  traduit, trie sur le libelle, et alimente une recherche qui accepte le
  libelle, l'id ou le nom du formateur.
- **Les surcharges se comptent.** Un badge par langage, un compteur global dans
  la barre, et une remise a zero complete derriere une confirmation - sinon rien
  ne dit ce qui a ete change ni comment revenir en arriere.
- **Un import atterrit au bon niveau.** Une option universelle va dans la base,
  une option de langage sur son langage. Verser `quoteStyle` dans la base
  l'imposerait a tout langage partageant ce nom.
- **Les options non supportees sont masquees**, pas grisees : un formulaire
  rempli de controles morts se lit comme casse. Un lien en bas de la colonne les
  revele et nomme le formateur qui les ignore, pour que "ou est passe ce
  reglage" ait une reponse.
- **L'export passe par une modale** (`ExportModal.svelte`) : le format cible s'y
  choisit avec sa description, et ce que ce format ne sait pas exprimer est
  affiche **avant** l'ecriture, calcule depuis le `supported` du catalogue.
  Une liste deroulante seule dans la barre n'expliquait ni ce qu'elle produisait
  ni ce qu'elle perdait.

Les controles viennent des composants du projet, jamais du natif : `Select.svelte`
pour tout choix (formateur, valeurs d'enum, format d'export) et la `search-bar`
de la liste de projets pour la recherche de langage.

## 6. Tests

- `resolve.ts` : chaine d'heritage complete, surcharge partielle, remise a zero.
- Adaptateurs : pour chaque formateur, modele -> config native -> modele est un
  aller-retour stable sur les options supportees.
- Import : un `.prettierrc` reel, un `.editorconfig` avec plusieurs sections, un
  `pyproject.toml` sans section outil, un JSON invalide.
- Detection d'extension -> langage -> formateur, y compris les extensions
  ambigues (`.h`, `.ts` vs `.tsx`).
- Rust : ecriture atomique, `serde(default)` sur chaque champ (une config d'une
  version anterieure doit se charger).

## 7. Installation des binaires

Cairn installe deja les serveurs de langage : le catalogue LSP porte
`install` / `uninstall` / `update` / `check`, un `ManagerCommands` par
gestionnaire (`npm`, `brew`, `cargo`, `pip`, `go`, `gem`), et
`commands/lsp/mod.rs` expose `install_language_server`,
`uninstall_language_server`, la verification de mise a jour et l'annulation d'un
install en cours. Les formateurs suivent **exactement le meme chemin** : refuser
d'installer ici rendrait l'etat vide de la page un cul-de-sac ("prettier
introuvable" sans rien a cliquer) alors que la page voisine sait le faire.

Plutot que de dupliquer cette plomberie, on l'**extrait** dans un module partage
(`commands/toolchain.rs`) : `ManagerCommands`, `ManagerOption`,
`run_manager_command`, la resolution du gestionnaire, la detection de version et
l'annulation cessent d'etre indexees sur un `server_id` pour prendre le couple
(catalogue, id). Le catalogue LSP et le catalogue de formateurs s'y branchent
tous les deux ; c'est un refactor a comportement constant du cote LSP, couvert
par ses tests existants.

Chaque `FormatterDef` gagne donc `install`, `uninstall`, `update`, `check`, et
la ligne du formateur dans l'UI reprend la meme rangee detecter / installer /
mettre a jour / desinstaller que celle d'un serveur.

Deux exceptions, qui doivent etre dites par l'UI et pas seulement echouer :

- `rustfmt` et `gofmt` viennent avec leur toolchain. Aucun `install` : la ligne
  renvoie vers rustup / l'installation de Go, avec le `doc_url`.
- Famille JS : si le projet porte deja `prettier` ou `biome` dans
  `node_modules/.bin`, Cairn ne propose rien a installer. Poser une seconde copie
  globale est precisement ce qui fait diverger les versions - et donc le
  resultat du formatage entre l'editeur et la CI.

## 8. Perimetre

Formateurs du catalogue v1 : `prettier`, `biome`, `rustfmt`, `gofmt`,
`ruff` / `black`, `clang-format`, `php-cs-fixer`, `ktlint`, `shfmt`, `taplo`.
Un formateur hors catalogue reste utilisable via `command` / `args`.

Hors perimetre : formatage de la selection seule, formatage de tout un depot en
une passe, regles de lint (le formatage n'est pas le lint).

## 8. Changelog

Une entree `added` dans `src/lib/data/changelog.json`, `en` et `fr`, sur la
version en developpement, au moment ou la fonctionnalite atterrit.
