# Performance

Audit mené sur la v0.12.0 et corrections apportées.

## Mesures

Binaire de release, `HOME` isolé sur une copie de l'état réel, fenêtre laissée en
arrière-plan, `git` remplacé par un shim qui journalise chaque invocation.

| Mesure | Avant | Après |
| --- | --- | --- |
| Process `git` lancés, 30 s au repos | 81 | 0 |
| Process `git` lancés au démarrage (8 s) | 66 | 57 |
| Écritures de `ui-state.json` au repos | continues, ~1 par 300 ms | 1 au démarrage, puis aucune |

Le zéro au repos vient du fait que la fenêtre n'a pas le focus : le rafraîchissement de
fond reprend au retour du focus. Le gain n'est donc pas « moins de fraîcheur », c'est
« plus rien pendant qu'on regarde ailleurs ».
 Le fil conducteur : l'application
faisait beaucoup de travail que personne n'avait demandé - deux fois le même chargement
sur un changement de projet, des process git pour une fenêtre au second plan, une
écriture disque toutes les 300 ms, et du travail bloquant sur le thread de l'interface.

## 1. Le changement de projet ne charge plus tout deux fois

`activeInstance` se dérive des instances et du projet actif. Tant que les instances du
projet visé n'étaient pas lues, la liste contenait encore celles du projet précédent : la
recherche échouait et le store retombait sur `baseInstance(projet)`, dont le
`worktreePath` est la racine du dépôt. Le chemin observé par les vues était donc
`worktree A` -> `racine B` -> `worktree B`, et chaque consommateur travaillait deux fois,
la première contre le mauvais dossier : arbre de fichiers relu entièrement, six commandes
git de `refreshStatus`, `refreshLog`, purge du store git.

Deux changements lèvent le problème :

- les instances sont conservées **par projet** (`instancesByProject` dans
  `stores/instance.ts`). Une clé absente signifie « pas encore chargé », ce qui permet à
  `activeInstance` de rendre `null` au lieu d'inventer une instance de base ;
- `switchTo()` dans `routes/+page.svelte` charge les instances du projet visé **avant**
  de basculer `activeProjectId`, si bien que la clé est toujours présente au moment du
  basculement. Le worktree passe directement de A à B.

`activeInstance` déduplique aussi ses émissions : un store dérivé republie un objet même
identique, et chaque vue lit une émission comme un changement de worktree.
`baseInstance()` mémorise son objet par projet pour la même raison.

**Invariant à préserver :** ne jamais poser `activeProjectId` sur un projet dont les
instances ne sont pas chargées. Le passage par `switchTo()` est ce qui le garantit.

## 2. Plus de réécriture d'état toutes les 300 ms

`persistUiState()` appelait `snapshotCurrentProject()`, qui écrivait un objet neuf dans
le store ; `viewStates.subscribe(() => persistUiState())` réarmait alors le minuteur de
300 ms. Le cycle ne se refermait jamais : `ui-state.json` était réécrit sur disque toutes
les 300 ms tant que l'application tournait.

`snapshotCurrentProject()` et `updateProjectViewState()` passent désormais par `commit()`
(`stores/view-state.ts`), qui compare l'état champ par champ et n'écrit pas si rien n'a
bougé. Un store Svelte notifie ses abonnés pour toute écriture d'objet, même identique :
la seule façon de rester silencieux est de ne pas écrire du tout.

## 3. Un seul poller de statut git, et seulement quand ça se voit

Deux minuteurs tournaient en parallèle, indépendamment de ce qui était affiché :
`GitView` lançait `refreshStatus` (six commandes git) toutes les 5 s et `FilesView`
`git_status` toutes les 3 s - y compris sur l'écran d'accueil, fenêtre au second plan, et
onglet Git fermé.

`startGitPolling()` (`stores/git.ts`) est maintenant le seul propriétaire du
rafraîchissement de fond. `Workspace` le démarre au montage et l'arrête à la destruction.
Il ne déclenche que si le workspace est l'écran affiché **et** que la fenêtre a le focus,
et rafraîchit immédiatement au retour de l'un ou de l'autre.

`FilesView` ne sonde plus : l'arbre suit `$git.status` via `adoptStoreStatus()`. Le champ
`statusWorktree` du store dit de quel worktree vient le statut, ce qui permet à un
consommateur d'ignorer une donnée qui ne le concerne pas encore.

`refreshStatus()` regroupe enfin les appels concurrents : les trois chemins qui le
déclenchent sur un changement de worktree (chargement de l'arbre, watcher de GitView,
réactif `activeStep === 'git'`) se rabattent sur une seule exécution de suite au lieu
d'ouvrir chacun six process.

**Attention en modifiant ce regroupement :** l'exécution de suite démarre *après* que
celle en cours ait rendu la main, elle ne la rejoint pas. Un appelant qui rafraîchit juste
après avoir indexé un fichier doit voir le dépôt tel qu'il est, pas tel qu'il a été lu un
instant avant sa modification. Rejoindre le vol en cours servirait un statut périmé, et le
symptôme serait « le fichier indexé reste dans la mauvaise colonne pendant trois
secondes ».

## 4. Les commandes bloquantes ont quitté le thread principal

Une commande `#[tauri::command] fn` synchrone s'exécute sur le thread principal, qui est
aussi celui de la webview sur macOS. Une trentaine de commandes y faisaient un walk
complet du dépôt ou lançaient un process `git` : `read_dir_tree`, `quick_search`,
`read_file` / `write_file`, `is_git_repo`, `git_current_branch`, `git_remote_status`
(deux process), `git_operation_state`, `git_commit`, tous les `git_stash_*`, etc. Toutes
sont passées `pub async fn` ; le corps reste du code bloquant ordinaire, Tauri exécute
les commandes `async` hors du thread principal.

Restent volontairement synchrones les commandes qui ne font que lire ou écrire un petit
fichier JSON d'état, conformément à la règle du CLAUDE.md.

## 5. L'arbre de fichiers revient instantanément

Le walk du dépôt est l'étape la plus lente d'un changement de worktree. `FilesView`
conserve les huit derniers arbres (`treeCache`) : revenir sur un projet déjà visité peint
depuis le cache immédiatement, et le walk repart silencieusement derrière pour corriger
ce qui a changé. Le cache est borné, un arbre retenant tous les chemins d'un dépôt.

`loadTree()` abandonne son résultat si le worktree a changé pendant le walk, ce qui évite
qu'un chargement lent écrase l'arbre du projet suivant.

## Ce qui reste ouvert

- `read_dir_tree` renvoie l'arbre complet du dépôt d'un coup, alors que seuls les dossiers
  dépliés sont rendus. Un chargement paresseux par dossier réduirait la charge utile IPC
  sur les très gros dépôts ; le cache ci-dessus en masque le coût sans le supprimer.
- `Icon.svelte` est une chaîne de 83 `{:else if}` : chaque icône rendue parcourt la
  chaîne. Sans effet mesurable constaté, mais c'est le prochain candidat si le rendu de
  listes longues devient un sujet.
- Un tick de fond lance huit process git juste pour détecter que rien n'a bougé. Sonder
  d'abord `git status --porcelain` seul et ne dérouler le refresh complet qu'en cas de
  changement diviserait encore la charge par huit. Écarté pour l'instant : la branche
  courante, l'état amont et une opération en cours changent sans que le statut bouge, et
  les manquer se verrait.
