# Plan - Release multi-plateforme et mise a jour in-app (V0.12.0)

## Objectif

Deux chantiers lies par un meme artefact:

1. **Release automatique.** Poser un tag `vX.Y.Z` sur `main` produit, sans intervention, les
   installeurs de Cairn pour macOS (universel Intel + Apple Silicon), Windows (x64 + arm64) et
   Linux (x86_64 + aarch64), publies avec un manifeste signe.
2. **Mise a jour in-app.** Au lancement puis periodiquement, Cairn compare sa version au
   manifeste. Si une version plus recente existe, une carte apparait au-dessus du numero de
   version, ouvre une modale, et la mise a jour se fait depuis l'app avec redemarrage.

## Decisions actees

| Sujet | Choix |
| --- | --- |
| Infra de build | Miroir push GitLab (`main` + tags) -> GitHub, builds sur GitHub Actions |
| Visibilite GitHub | **Public des le premier push** (runners standard gratuits, sans quota) |
| Hebergement des binaires + manifeste | GitHub Releases du meme repo |
| macOS | **Un seul package universel** (`universal-apple-darwin`) |
| Windows | Deux installeurs NSIS natifs: x64 et arm64 |
| Linux | AppImage uniquement (x86_64 + aarch64) |
| Signature macOS | Apple Developer ID: signature + notarisation |
| Signature Windows | Aucune pour l'instant (SmartScreen avertira) |

`gitlab.bonneton.dev` reste le depot de travail (tests, lint, quality, MR). GitHub ne sert qu'a
executer la matrice de build et a distribuer.

Trois consequences a garder en tete, detaillees plus bas:

- **macOS universel** supprime le piege du mauvais lien: aujourd'hui un utilisateur Apple Silicon
  qui telecharge un DMG Intel obtient une app qui fonctionne en Rosetta sans jamais le savoir. Un
  seul DMG, un seul job, une seule notarisation, au prix d'un binaire plus lourd.
- **Pas d'installeur Windows unifie**: aucun equivalent du binaire universel n'existe sur Windows,
  et le bundler NSIS produit un installeur par target.
- **Repo public des le depart**: les minutes Actions sont gratuites et illimitees sur les runners
  standard, les runners arm64 disposent de 4 vCPU au lieu de 2, et les assets des Releases sont
  telechargeables sans token, donc l'endpoint de l'updater fonctionne immediatement. En echange,
  tout l'historique git est public des le premier push du miroir: a auditer avant.
- **L'AppImage** couvre a la fois Debian et Arch: Tauri n'a pas de bundler `pacman`, et c'est le
  seul format Linux que l'updater sait mettre a jour en place.

## 1. Version: source de verite unique

La version du bundle vient de `src-tauri/Cargo.toml`, celle affichee dans l'UI de
`package.json` (`__APP_VERSION__`, deja injecte par `vite.config.js`). Un ecart entre les deux
casse silencieusement l'updater (l'app se croit a jour). Regle:

- Bump manuel des deux fichiers (`package.json`, `src-tauri/Cargo.toml`), puis `cargo check` pour
  rafraichir `Cargo.lock`.
- Commit `chore(release): v0.12.0`, puis `git tag v0.12.0 && git push --tags`.
- Un job GitLab `version-check` (sur tag uniquement) echoue si
  `tag != package.json.version != Cargo.toml.version`. Le tag ne peut donc pas mentir.

Aucune indirection ajoutee dans `tauri.conf.json`: deux fichiers a bumper, une verification CI.

## Etat de l'implementation

Livre dans le code:

- `src-tauri/`: plugins `updater` + `process` enregistres (`lib.rs`), permissions `updater:default`
  et `process:allow-restart` (`capabilities/default.json`), `createUpdaterArtifacts` + `pubkey` +
  endpoint (`tauri.conf.json`), champ `autoCheckUpdates` (`commands/settings.rs`).
- Frontend: `services/update-service.ts`, `stores/update.ts`, `components/layout/UpdateModal.svelte`,
  `UpdateCard.svelte`, `UpdateProgress.svelte`, points d'entree dans `HomeSidebar.svelte`,
  `Workspace.svelte` et `settings/GeneralTab.svelte`, cles `update.*` et
  `settings.general.updates.*` en/fr, `formatBytes` dans `utils/format.ts` (teste).
- CI: `.github/workflows/release.yml`, `scripts/build-updater-manifest.mjs`, job `version-check`
  dans `.gitlab-ci.yml`.

L'endpoint pointe sur `https://github.com/Cairn-Foundry/cairn-app/releases/latest/download/latest.json`.
Le depot GitHub doit donc s'appeler exactement `cairn-app` sous l'organisation `Cairn-Foundry`: c'est
le seul endroit ou le nom est ecrit en dur (le workflow derive ses URLs de `GITHUB_REPOSITORY`), et
il ne pourra plus changer sans casser les clients deja installes.

Reste a faire, manuellement:

1. Creer le repo GitHub public `Cairn-Foundry/cairn-app` et configurer le miroir (section 4).
2. Poser les secrets GitHub (section 5).
3. La cle de signature est **deja generee** dans `~/.tauri/cairn.key` (sans mot de passe) et sa cle
   publique est commitee dans `tauri.conf.json`. La sauvegarder hors de la machine. Pour la proteger
   par un mot de passe, la regenerer maintenant - c'est sans consequence tant qu'aucune version
   n'est publiee - et reporter la nouvelle cle publique dans `tauri.conf.json`.
4. Auditer l'historique avant le premier push (fait: 151 commits, aucun `.env`/cle/token, deux
   adresses d'auteur dont une professionnelle qui deviendra publique).

## 2. Cle de signature de l'updater

Independante de la signature Apple. C'est elle qui garantit qu'un binaire telecharge vient bien
de nous; l'updater Tauri refuse tout artefact non signe et cette verification ne peut pas etre
desactivee.

    bunx tauri signer generate -w ~/.tauri/cairn.key

- Cle privee + mot de passe -> secrets GitHub `TAURI_SIGNING_PRIVATE_KEY` et
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Jamais commitees.
- Cle publique -> `tauri.conf.json` (`plugins.updater.pubkey`), commitee.
- Sauvegarde hors CI de la cle privee: la perdre signifie que plus aucun client existant ne
  pourra se mettre a jour (il faudrait redistribuer l'app a la main).

## 3. Configuration Tauri

`src-tauri/tauri.conf.json`:

```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "pubkey": "<contenu de cairn.key.pub>",
      "endpoints": [
        "https://github.com/Cairn-Foundry/cairn-app/releases/latest/download/latest.json"
      ]
    }
  }
}
```

`bundle.targets` reste `"all"`: c'est la CLI qui restreint par plateforme via `--bundles`.

`src-tauri/Cargo.toml`: `tauri-plugin-updater = "2"`, `tauri-plugin-process = "2"`.

`src-tauri/src/lib.rs`: enregistrement des deux plugins a la suite des existants. Pas de garde
`#[cfg(desktop)]`: Cairn n'a pas de cible mobile, la garde serait du bruit.

`src-tauri/capabilities/default.json`: ajout de `"updater:default"` et `"process:allow-restart"`.

## 4. Miroir GitLab -> GitHub

Exigence: chaque commit sur `main` doit arriver sur GitHub, et les tags aussi (ils declenchent la
release).

1. Creer le repo GitHub `Cairn-Foundry/cairn-app`, **public** (licence AGPL-3.0 deja en place).
2. GitLab: Settings > Repository > Mirroring repositories, direction **Push**, URL
   `https://<gh-user>:<PAT>@github.com/Cairn-Foundry/cairn-app.git`, PAT GitHub avec scope `repo`.
3. Cocher **Mirror only protected branches** et proteger `main`: seule `main` part sur GitHub (les
   branches de travail restent chez nous) et le miroir se declenche en ~1 minute apres chaque push
   au lieu de ~5. Ajouter une regle de **protected tags** sur `v*`.
4. Le push du miroir est authentifie par un PAT utilisateur, donc il declenche bien les workflows
   GitHub Actions (seuls les pushs faits avec `GITHUB_TOKEN` sont exclus).
5. **A verifier des la mise en place** (la doc GitLab ne le garantit pas explicitement): qu'un tag
   `v0.11.1-test` pousse sur GitLab apparaisse bien sur GitHub. Si les tags ne sont pas mirroires
   avec l'option "protected branches", repli: un job GitLab `mirror-tag` (sur tag uniquement) qui
   fait un `git push https://<PAT>@github.com/... <tag>` avec le PAT en variable masquee. Le
   workflow GitHub reste declenche par le tag dans les deux cas.

## 5. Matrice de build GitHub Actions

`.github/workflows/release.yml`, declenche sur `push: tags: ['v*']`, plus `workflow_dispatch` qui
prend le tag a rejouer et une case `linux_only` pour repeter le pipeline sur la seule entree Linux
x86_64 (repetition rapide, sans passer par les 5 plateformes).

### Job `verify`

Rejoue cote GitHub le controle de version du job GitLab: un tag pousse directement sur le miroir ne
doit pas contourner la verification. Il expose aussi `tag`, `version` et `notes` aux jobs suivants.
Les notes de version sont le **message du tag annote** (`git tag -l --format='%(contents)'`): un
`git tag -a v0.12.0 -m "..."` remplit donc la modale de mise a jour, un tag leger la laisse vide et
la modale masque simplement le bloc.

### Job `build` (matrice, 5 entrees)

| Entree | Runner | Target Rust | Bundles | Cles updater |
| --- | --- | --- | --- | --- |
| macos-universal | `macos-latest` | `universal-apple-darwin` | `dmg`, `app` | `darwin-aarch64` **et** `darwin-x86_64` |
| windows-x64 | `windows-latest` | `x86_64-pc-windows-msvc` | `nsis` | `windows-x86_64` |
| windows-arm64 | `windows-11-arm` | `aarch64-pc-windows-msvc` | `nsis` | `windows-aarch64` |
| linux-x64 | `ubuntu-22.04` | `x86_64-unknown-linux-gnu` | `appimage` | `linux-x86_64` |
| linux-arm64 | `ubuntu-22.04-arm` | `aarch64-unknown-linux-gnu` | `appimage` | `linux-aarch64` |

Details qui comptent:

- Le build universel exige les deux targets Rust installes (`rustup target add
  aarch64-apple-darwin x86_64-apple-darwin`) et compile donc deux fois: le job macOS est le plus
  long de la matrice.
- Les deux cles updater macOS pointent vers **le meme** `.app.tar.gz` universel. Une app en cours
  d'execution annonce l'architecture de la slice qui tourne, donc les deux entrees doivent exister
  dans `latest.json`, sinon les Mac Intel ne verraient aucune mise a jour.
- `windows-11-arm` est un runner natif, ce qui evite les surprises du cross-compile
  `aarch64-pc-windows-msvc` avec NSIS.
- Linux en **22.04** volontairement: la glibc du runner devient le plancher de compatibilite de
  l'AppImage.
- Ne pas passer aux *larger runners*: ils sont factures meme sur un repo public. Les runners
  standard (`macos-latest`, `windows-latest`, `windows-11-arm`, `ubuntu-22.04`, `ubuntu-22.04-arm`)
  sont gratuits et suffisent.
- `actions/upload-artifact` avec `retention-days: 1` sur toutes les entrees. Le quota de stockage
  du plan Free est de 500 Mo comptes en Go-mois: un lot de ~400 Mo d'installeurs conserve 1 jour ne
  coute qu'environ 13 Mo-mois, alors qu'avec la retention par defaut (90 jours) une seule release
  saturerait le quota.
- Le cache Rust est limite a 10 Go par depot, toutes cles confondues. Cinq entrees de matrice a
  ~1,5 Go chacune vivent juste sous la limite: si des evictions apparaissent, ne garder le cache
  que sur les jobs les plus lents (macOS et les deux arm64) plutot que d'en ajouter.
- Dependances Linux a installer: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev
  patchelf libxdo-dev libssl-dev build-essential curl wget file`.
- Etapes communes: `oven-sh/setup-bun`, `dtolnay/rust-toolchain@stable` avec le(s) target(s),
  `Swatinem/rust-cache` (cle par entree), `bun install --frozen-lockfile`, `bun tauri build
  --target <t> --bundles <b>`.
- Chaque entree publie ses bundles et leurs `.sig` via `actions/upload-artifact`. **Aucune** entree
  ne touche la GitHub Release.

### Job `release` (unique, `needs: build`)

1. `actions/download-artifact` de tout.
2. `node scripts/build-updater-manifest.mjs <version>`: parcourt les artefacts, associe chaque
   fichier a sa (ses) cle(s) de plateforme, lit le `.sig` correspondant, et ecrit un `latest.json`
   deterministe:

```json
{
  "version": "0.12.0",
  "notes": "...",
  "pub_date": "2026-07-30T12:00:00Z",
  "platforms": {
    "darwin-aarch64": { "signature": "<contenu du .sig>", "url": "https://github.com/Cairn-Foundry/cairn-app/releases/download/v0.12.0/cairn_0.12.0_universal.app.tar.gz" },
    "darwin-x86_64":  { "signature": "<meme .sig>",       "url": "<meme url universelle>" }
  }
}
```

   Le script echoue si une des 6 cles de plateforme manque: pas de release partielle qui
   laisserait une plateforme sans chemin de mise a jour.
3. `softprops/action-gh-release`: cree la release `v0.12.0` avec les 4 installeurs (DMG universel,
   2 NSIS, 2 AppImage), les `.sig` et `latest.json`, notes generees depuis les commits.

Pourquoi ne pas utiliser `tauri-action` avec `includeUpdaterJson` par entree de matrice: chaque
job reecrirait le meme asset `latest.json` en parallele et le dernier arrive ecrase les autres.
Un job d'assemblage unique supprime la course. Cout: ~40 lignes de script a nous.

La release doit etre publiee (ni draft ni prerelease), sinon
`/releases/latest/download/latest.json` ne resout pas et l'updater ne voit rien.

### Secrets GitHub requis

`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `APPLE_CERTIFICATE` (p12 en
base64), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`
(`Developer ID Application: ... (TEAMID)`), `APPLE_ID`, `APPLE_PASSWORD` (mot de passe
d'application), `APPLE_TEAM_ID`. La CLI Tauri importe elle-meme le certificat dans un keychain
temporaire et appelle `notarytool`; rien a scripter.

## 6. Recette locale de l'updater

Utile pour valider le code client et le script de manifeste sans consommer une release, et pour
iterer sur l'UI de mise a jour. L'endpoint HTTP en clair est acceptable ici parce qu'il s'agit
strictement de `localhost` en developpement; la configuration commitee reste en HTTPS.

1. Construire la version courante avec un endpoint local, sans toucher au fichier commite:
   `bun tauri build -c '{"plugins":{"updater":{"endpoints":["http://localhost:8080/latest.json"]}}}'`.
   Installer ce build.
2. Bumper en `0.12.0`, rebuilder, recuperer le `.app.tar.gz` (ou l'AppImage) et son `.sig`.
3. Servir un dossier contenant l'artefact et un `latest.json` ecrit par le meme script que la CI
   (`python3 -m http.server 8080`).
4. Lancer la version installee: la carte doit apparaitre, la modale afficher les notes, le
   telechargement progresser, l'app redemarrer en `0.12.0`.

## 7. Mise a jour in-app

### Couches

- `src/lib/services/update-service.ts` - **seule** couche qui parle a
  `@tauri-apps/plugin-updater` / `plugin-process` (meme regle que `invoke()`): `checkUpdate()`,
  `downloadAndInstall(onProgress)`, `restartApp()`.
- `src/lib/stores/update.ts` - etat reactif:

```ts
type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'error';

interface UpdateState {
  phase: UpdatePhase;
  version: string | null;
  notes: string | null;
  downloaded: number;
  total: number | null;
  error: string | null;
}
```

  API: `checkForUpdates({ silent })`, `installUpdate()`. Un check `silent` avale ses erreurs (hors
  ligne, endpoint injoignable) et ne remonte jamais d'erreur a l'ecran; seul un check declenche par
  l'utilisateur passe en `error`. No-op hors contexte Tauri.
- `src/lib/components/layout/UpdateModal.svelte` - version actuelle -> nouvelle, notes de version,
  barre de progression alimentee par `downloaded / total`, `Spinner` pendant `installing`, boutons
  "Mettre a jour maintenant" / "Plus tard". A la fin: `restartApp()`. Les notes sont affichees en
  **texte brut** (`white-space: pre-wrap`), pas via `{@html}` d'un rendu markdown: elles arrivent
  par le reseau, et le gain visuel ne justifie pas d'ouvrir une injection HTML dans la webview.

### Declenchement

Dans `+page.svelte` (`onMount`, apres `settings.load()`):

- Check au lancement differe de ~5s pour ne pas concurrencer le chargement des projets.
- `setInterval` toutes les 6h (constante `CHECK_INTERVAL_MS` dans le store), demarre seulement si
  `settings.autoCheckUpdates`, nettoye dans `onDestroy`.

### Points d'entree UI

1. **Carte dans le HomeSidebar** (point d'entree principal) -
   `src/lib/components/layout/UpdateCard.svelte`, insere **juste au-dessus** de la ligne
   `v{__APP_VERSION__}`, apres le spacer `flex: 1`. Rendue uniquement quand une mise a jour existe:
   icone `download`, "Nouvelle version disponible", le numero de version, un bouton "Mettre a jour"
   qui ouvre la modale. Pendant un telechargement, la carte porte une barre de progression fine,
   pour que fermer la modale ne fasse pas perdre l'information.
2. **Sidebar du Workspace** (secondaire, sinon l'info est invisible quand on travaille dans un
   projet) - un bouton `.step` en bas (icone `download`), rendu uniquement quand une mise a jour
   est disponible, avec la meme pastille accent que `conflict-dot`. Clic -> modale.
3. **Settings > General** - nouveau groupe "Mises a jour": version actuelle, toggle "Verifier
   automatiquement" (pattern `.settings-toggle` existant), bouton "Verifier maintenant" (Spinner
   pendant le check) affichant "a jour" ou la version trouvee.

La modale et la carte sont des etats transitoires, pas une vue qui prend le main area: rien a
persister dans `ui-state`. "Plus tard" ne ferme que la modale; la carte reste.

### Nouveau champ de settings

`autoCheckUpdates: boolean` (defaut `true`), ajoute des deux cotes: `CairnSettings` Rust
(`commands/settings.rs`, `#[serde(default)]` + defaut) et TS (`settings-service.ts` + `DEFAULTS`
dans `stores/settings.ts`), plus une entree dans `utils/home/settings-registry.ts` pour la
recherche de reglages.

### i18n

Nouvelles cles `update.*` dans `src/lib/i18n/en.ts` et `fr.ts`, plus les libelles du groupe
`settings.general.updates.*`. Conformement aux conventions: aucune cle de type "loading" - les
etats d'attente sont un `Spinner` ou la barre de progression.

## 8. Comportement par plateforme

| Plateforme | Format installe | Update in-app |
| --- | --- | --- |
| macOS Intel + Apple Silicon | `.dmg` universel (signe + notarise) | Oui, via `.app.tar.gz` universel |
| Windows x64 / arm64 | NSIS `.exe` natif | Oui, relance l'installeur |
| Linux x86_64 / aarch64 | `.AppImage` | Oui, remplace l'AppImage en place |

Windows non signe: SmartScreen affichera "editeur inconnu" a la premiere installation, y compris
pour une mise a jour appliquee par l'updater. Rien a faire cote code; l'ajout d'un certificat OV ou
EV plus tard ne demandera que des secrets supplementaires.

## 9. Ordre d'implementation

1. Audit de l'historique git (aucun secret commite), repo GitHub public cree, secrets poses,
   mirroring GitLab configure et **arrivee des tags verifiee**. (Prerequis manuels, hors code.)
2. Config Tauri: plugins `updater` + `process`, capabilities, `createUpdaterArtifacts`, `pubkey`,
   endpoint. Verifier que `bun tauri build` local produit bien les `.sig`.
3. `.github/workflows/release.yml` + `scripts/build-updater-manifest.mjs`. Valide via
   `workflow_dispatch` sur un tag de test `v0.11.1-test`.
4. Job `version-check` dans `.gitlab-ci.yml`.
5. Service + store `update`, `UpdateModal.svelte`, `UpdateCard.svelte`.
6. Points d'entree UI (HomeSidebar, sidebar Workspace, Settings General) + champ
   `autoCheckUpdates` + i18n en/fr.
7. Recette locale de la section 6, de bout en bout.
8. `bun run check`, `bun run lint`, `bun run test`.
9. Premiere release: bump `0.12.0`, tag, puis verification du parcours reel en installant la
   `0.11.0` et en la mettant a jour depuis l'app.

## 10. Risques identifies

- **Historique git public des le premier push du miroir.** A auditer avant (aujourd'hui `.env` est
  bien gitignore). C'est la seule action irreversible du plan.
- **Cache Actions limite a 10 Go par depot**, toutes cles confondues, y compris sur repo public.
  Cinq entrees de matrice avec cache Rust vivent juste sous la limite; en cas d'evictions, ne
  garder le cache que sur les jobs les plus lents.
- **Notarisation et processus enfants.** Cairn lance le CLI Claude et des PTY. Si le durcissement
  du runtime bloque un lancement apres notarisation, il faudra un fichier d'entitlements
  (`com.apple.security.cs.allow-dyld-environment-variables`,
  `com.apple.security.cs.disable-library-validation`) reference dans `bundle.macOS.entitlements`.
  A traiter seulement si le symptome apparait.
- **Premiere notarisation lente** (parfois plusieurs heures cote Apple). Le flag `--skip-stapling`
  existe si le job depasse le timeout, au prix d'un ticket non attache.
- **Perte de la cle de signature updater**: aucun rattrapage possible pour les clients installes.
  Sauvegarde obligatoire avant la premiere release.
