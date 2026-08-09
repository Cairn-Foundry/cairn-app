# Agents en arriere-plan, avec leur propre contexte

Statut: implemente (2026-08-09), les quatre phases. Remplace la partie "rows" de
`agent-personas.md`, qui reste la reference pour les sessions par provider d'une
*conversation*.

Ecarts avec le plan initial, decides pendant l'implementation:

- `AgentThread.lastSyncedAt` est devenu `syncedMessages`: un message porte une
  heure d'affichage, pas un timestamp, donc le delta se compte.
- La reponse aux permissions et le bail vivent dans `stores/agent-runs.ts` et
  `utils/agent/write-lease.ts`, pour que la vue Agents puisse repondre et
  arreter sans passer par `AgentView`, qui garde le lancement.
- `runOfConversation` ignore les runs d'agent: sans cela un agent en cours
  bloquait l'envoi de sa propre conversation, l'inverse du but.
- La vue Agents n'est pas un outil du panneau Outils: elle vit dans la vue
  Agent (voir "UI" ci-dessous), ou l'utilisateur est deja quand il mentionne un
  agent. `agentsActive` a donc ete remplace par `openAgentRunId`, qui porte la
  meme regle des quatre couches.
- Un run porte son `usage`, comme un tour ordinaire.

Aujourd'hui un agent n'est qu'un habillage du run de la conversation:
`buildRunOptions` traduit la persona en `--append-system-prompt`,
`--allowedTools` et un modele, puis le CLI est relance sur la session de la
conversation. L'agent n'a pas de contexte, il consomme celui de son appelant, et
son travail se melange au fil principal.

Objectif: un agent devient un interlocuteur separe. Il tourne dans son propre
processus, garde sa propre memoire, travaille pendant que la conversation
continue, et rend une reponse qui revient dans la conversation qui l'a appele.

## Decisions

1. **Un agent est lie a un provider unique, ou herite.** `providerId` vide
   signifie "celui de la conversation appelante", modele, effort et permission
   compris. Les `rows` disparaissent.
2. **Un contexte par (agent, conversation).** Leonardo appele depuis la
   conversation A et Leonardo appele depuis la conversation B sont deux fils
   independants. Le meme agent peut donc tourner en parallele dans plusieurs
   conversations.
3. **Un appel d'agent est un run de fond**, suivi dans un panneau **Agents** de
   la vue Agent, jamais bloquant pour la conversation.
4. **L'echange entre l'agent et la conversation est asymetrique et lossy** (voir
   "Delimitation"). C'est la regle qui empeche les deux contextes de fusionner.
5. **Une conversation et ses agents travaillent en parallele.** Un bail
   d'ecriture par worktree a d'abord ete implemente pour rendre les conflits
   impossibles; il a ete retire (2026-08-09) parce qu'il serialisait ce qui doit
   justement pouvoir tourner ensemble - un message envoye pendant qu'un agent
   ecrit attendait la fin de l'agent. Le parallelisme prime sur la garantie.

## Delimitation: ce qui circule, et ce qui ne circule pas

Le risque de ce design est de retomber sur un seul contexte partage par deux
processus. La regle est donc etroite et va dans un seul sens a la fois.

**Conversation -> agent** (a chaque appel, incrementiel):

- les messages `user` et `agent` ajoutes *depuis le dernier appel de cet agent
  dans cette conversation*, jamais tout le fil;
- plafonne par `buildHandoffTranscript` (20 messages, ~6000 caracteres, les plus
  anciens tombent en premier);
- au premier appel, le delta est simplement tout ce qui precede, donc le cap
  fait tout le travail.

Ne circulent pas: l'activite outils de la conversation, ses messages `system`,
ses fichiers ouverts, son etat d'editeur.

**Agent -> conversation** (une fois, apres coup):

- son **message final uniquement**, insere comme message `agent` attribue a la
  persona;
- reinjecte dans le prompt du provider principal **au prochain envoi et une
  seule fois**, sous forme de bloc cite, parce que le CLI de la conversation n'a
  jamais vu ce tour et mentirait sinon.

Ne circulent pas: ses tours intermediaires, son activite outils, ses demandes de
permission, son prompt systeme. Tout cela reste consultable en entrant dans
l'agent.

Consequence voulue: un second agent peut relire le travail du premier, puisque
la reponse du premier est devenue un message de la conversation et entre donc
dans le delta du second. La verification entre agents passe par le fil, jamais
par un acces direct au contexte d'un autre agent. C'est la seule voie, et elle
est plafonnee comme le reste.

## Modele de donnees

### `CustomAgent` (Rust `commands/agent/config.rs`, TS `services/ai-provider-service.ts`)

```ts
interface CustomAgent {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  systemPrompt: string;
  allowedTools: string[];
  disallowedTools: string[];
  overrideParams: boolean;
  temperature: number;
  maxTokens: number;
  providerId: string;      // vide = herite de la conversation appelante
  model: string;           // vide = defaut du provider (ou herite si providerId vide)
  effort: string;
  permissionMode: string;
}
```

`rows: AgentProviderRow[]` est supprime. **Migration** (Rust, a la lecture, dans
`migrate_agent`): un agent avec des `rows` prend la premiere, `rows` vide donne
`providerId: ""`. Le champ reste deserialisable et n'est plus ecrit, comme l'ont
ete `providerId`/`model` lors de la migration precedente.

`resolveAgentRun` et `rowFor` (`utils/agent/agent-resolution.ts`) se reduisent a
deux cas nets:

- **`providerId` vide (herite)**: provider, modele, effort et permission sont
  ceux de la conversation, a chaque appel. L'agent suit donc la conversation
  quand elle change de provider, sans rien figer.
- **`providerId` renseigne (epingle)**: le provider est celui de l'agent, et un
  modele, effort ou permission vide retombe sur le defaut de *ce* provider,
  jamais sur la valeur de la conversation - elle appartient a un autre backend
  et n'y designe rien.

### Fil d'agent, porte par la conversation

Sur `ConversationMeta`:

```ts
/** Un fil par agent appele ici. La cle est l'id de l'agent. */
agentThreads: Record<string, AgentThread>;

interface AgentThread {
  /**
   * Une session par provider, comme `ConversationMeta.sessions`: un agent
   * `inherit` suit la conversation quand elle change de provider, et un id de
   * session ne veut rien dire pour un autre backend.
   */
  sessions: Record<string, string>;
  lastProviderId: string;  // le provider qui a repondu ici en dernier
  /**
   * Combien de messages de la conversation cet agent a deja recus. Un message
   * porte une heure d'affichage, pas un timestamp: le delta se compte, il ne
   * se date pas.
   */
  syncedMessages: number;
  lastRunId: string;
}
```

`sessions` (par provider) reste ce qu'il est: la session de la *conversation*.
Un fil d'agent ne l'ecrit ni ne la lit jamais. `agentId` sur `ConversationMeta`
devient inutile et disparait: une conversation n'a plus "un agent qui repond",
elle a des agents qu'elle appelle.

### Registre des runs de fond

Nouveau `stores/agent-runs.ts`, persiste par projet dans
`projects/{project-id}/agent-runs.json` (ajouter le chemin dans `storage.rs`).
Une entree par run:

```ts
interface AgentRun {
  id: string;            // runId, celui deja mint par le frontend
  agentId: string;
  instanceId: string;
  conversationId: string;
  scope: 'instance' | 'project';
  providerId: string;
  prompt: string;
  startedAt: number;
  endedAt: number | null;
  status: 'queued' | 'running' | 'awaiting-permission' | 'done' | 'stopped'
        | 'error' | 'interrupted';
  result: string;        // message final, vide tant qu'il n'est pas rendu
  delivered: boolean;    // reinjecte dans le prompt suivant de la conversation
  activity: ConversationActivity[];
  usage: MessageUsage | null;  // tokens, cout, duree, tours - comme un tour
  error: string;
}
```

Au demarrage de l'app, tout run laisse en `running` / `queued` /
`awaiting-permission` passe a `interrupted`: le processus est mort avec la
fenetre. La vue Agents l'affiche comme tel et propose de relancer le prompt, pas
de "reprendre" - la session CLI de l'agent existe toujours, donc relancer
reprend bien son contexte.

L'historique est borne: les 50 derniers runs termines par projet.

## Execution

Un appel d'agent est un `send_message` ordinaire, avec un `runId` propre. Rien a
changer cote Rust: `AgentState.running` est deja keye par `runId`, plusieurs runs
concurrents fonctionnent, et `stop_agent(runId)` en tue exactement un.

Ce qui change est cote frontend:

- `AgentView` n'envoie plus la mention comme options du run principal. Une
  mention produit un **run d'agent**: prompt = delta + texte de l'utilisateur,
  `sessionId` = celui du fil d'agent, options = persona (prompt systeme, outils,
  params) + resolution provider/modele.
- Le `session` remonte est ecrit dans
  `agentThreads[agentId].sessions[providerId]`, jamais dans le `sessions` de la
  conversation.
- A `[done]`, le dernier message `agent` du run devient `result`, est pousse
  comme message dans la conversation appelante et marque `delivered: false`.
- Au prochain envoi de la conversation, tous les runs `delivered: false` de
  cette conversation sont prefixes au prompt, dans un bloc cite, puis marques
  `delivered: true`. Meme mecanique que `withHandoffContext`, meme fichier.

### Changement de provider

Un agent herite suit la conversation. Quand le provider resolu pour un appel
differe de `agentThreads[agentId].lastProviderId`, le nouveau provider n'a
jamais vu ce fil: il faut lui passer le relais, exactement comme la conversation
principale le fait pour elle-meme.

- `sessionId = thread.sessions[providerId] ?? null` - vide s'il decouvre le fil,
  et il reprend sa propre session s'il y est deja passe avant.
- Le prompt de cet appel porte, en plus du delta habituel, le **transcript du
  fil de l'agent**: les paires (prompt, reponse finale) de ses runs precedents
  dans cette conversation, dans l'ordre, passees par `buildHandoffTranscript`
  donc plafonnees pareil. C'est la memoire de l'agent, et elle est deja stockee
  telle quelle dans `agent-runs.json` - rien de nouveau a persister.
- Uniquement au premier appel apres le changement: ensuite le nouveau provider
  a sa propre session dans `thread.sessions` et reprend normalement.
- La bascule est visible dans le detail du run ("Repris par <Provider>"), pas
  dans le fil de la conversation, qui a deja son propre marqueur de switch.

Un agent epingle ignore tout cela: son provider ne bouge jamais.

Le run tourne dans le worktree de l'instance. Une conversation de scope projet
utilise le worktree de l'instance active, comme le fait deja un terminal
partage.

### Conflits d'ecriture

Rien n'empeche deux processus d'ecrire le meme worktree en meme temps: c'est le
prix du parallelisme demande, assume plutot que masque. Le bail FIFO qui les
serialisait a ete retire avec `utils/agent/write-lease.ts` et le statut
`queued`.

### Permissions

Une demande `can_use_tool` venant d'un run de fond ne peut pas atterrir sur
`pendingPermission`, resolu sur la conversation courante: elle serait perdue et
l'agent bloque indefiniment. Les demandes sont indexees par `runId`; celles d'un
run d'agent passent le run en `awaiting-permission`, allument un badge sur le
bouton Agents et sont repondues depuis la fiche du run. La conversation
appelante montre la meme demande en ligne quand elle est ouverte, puisque c'est
la que l'utilisateur regarde le plus souvent.

## UI

### Panneau Agents, dans la vue Agent

Les agents se suivent la ou on les appelle, pas dans un outil separe.
`AgentRunsPanel.svelte` est un bandeau place **au-dessus de Live Activity**,
dans la colonne de droite de la vue Agent, avec le meme en-tete que lui. Il
liste **les agents de la conversation ouverte, un par agent** - pas un par run:
une persona appelee trois fois est un interlocuteur, pas trois. Chaque ligne
porte l'icone de la persona, le prompt de son dernier appel et son etat; le
badge compte les agents en cours sur le total.

Cette colonne est conditionnee par `agentShowLiveActivity`; elle s'affiche donc
aussi des qu'un run existe, sinon les agents disparaitraient avec un reglage qui
ne les concerne pas. Le bloc Live Activity, lui, reste gouverne par le reglage.

**Entrer dans un agent** (`AgentThreadView.svelte`) remplace la conversation
dans la zone principale, et ce qui s'y trouve est une vraie conversation: tout
le fil de l'agent dans cette conversation, chaque tour avec son prompt, son bloc
de raisonnement, son activite outils, sa reponse et son pied de message, plus un
composeur qui lui envoie un nouveau prompt - lequel continue son fil, jamais
celui de la conversation. **Reinitialiser le contexte** y fait oublier l'agent:
ses sessions tombent, `syncedMessages` repart de la longueur courante, et
`contextResetAt` marque la coupure d'un trait dans le fil. L'action passe par
une confirmation, parce qu'elle ne se defait pas. Rien n'est efface pour autant -
ce qu'il a repondu reste dans la conversation et au-dessus du trait.

Cote conversation, Live Activity porte les deux moments qui la concernent: la
ligne du lancement de l'agent, et celle du retour de sa reponse. Le detail de ce
que l'agent a fait entre les deux reste dans son fil. Une barre porte l'identite de la persona, son statut,
l'arret quand elle travaille, et le retour a la conversation. Le lien "voir son
travail complet" d'un message d'agent y mene directement.

Pour que ce fil vive comme une conversation, un run d'agent streame dans son
enregistrement: `result` et `thinking` s'accumulent au fil des evenements au
lieu d'attendre `[done]`, et sont donc a la fois affiches en direct et
persistes.

L'agent ouvert est de l'etat de vue et suit les quatre couches: `openAgentId`
dans `stores/ui.ts`, champ sur `ProjectUiState`, snapshot et restore dans
`view-state.ts`, champ Rust plus `subscribe(() => persistUiState())` dans
`+page.svelte`. Changer de conversation le referme: un agent appartient a une
conversation.

### Fenetre de contexte

La fenetre vient du provider, pas d'une table locale: l'evenement `result` du
CLI porte `modelUsage[model].contextWindow`, la seule source qui distingue un
modele 200k de sa variante 1M - un identifiant de modele ne le dit pas. Elle est
emise avec l'usage et stockee sur le message. La table de `providers-data.ts`
reste en repli, et quand personne ne sait, la pastille affiche des tokens et
aucun pourcentage: un denominateur suppose donnait un "100%" permanent et faux.

Le numerateur compte le prompt entier plus la reponse - tokens envoyes, lus du
cache **et ecrits dans le cache**. Sans les ecritures de cache, un premier tour
qui vient d'installer 26k tokens de contexte s'affichait a 6 tokens.

### Cout

Un run porte son `usage` (`AgentRun.usage`), renseigne par l'evenement `usage`
du provider et recopie sur le message livre dans la conversation. Il gagne donc
le meme pied de message que n'importe quel tour, et `sessionStats` le compte
deux fois: dans la section **Modeles** du menu de cout, et dans une section
**Agents**, sous le nom de la persona - la seule ligne sur laquelle
l'utilisateur peut vraiment agir. Les totaux, eux, ne comptent chaque message
qu'une fois.

### Message d'agent dans la conversation

Un message rendu par un agent ne doit pas se lire comme un message du provider,
sinon l'utilisateur conclura que le contexte est partage - l'inverse exact de ce
qui est construit. Il porte la couleur et l'icone de la persona, son nom, et un
lien "voir le travail complet" vers son run dans la vue Agents. L'activite
outils du run n'est pas dupliquee dans le fil.

Le composeur signale la mention comme aujourd'hui, mais avec le sens nouveau:
"lance <agent> en arriere-plan", pas "ce message sera repondu par <agent>".

### Fiche agent

Le groupe "Providers" a cartes multiples redevient une paire provider/modele,
avec une option **Herite de la conversation** en tete de la liste des providers.
Effort et permission mode reviennent au meme niveau. Le sous-titre de la liste
maitre affiche le provider, ou "Herite".

## Tests

- Migration Rust `rows` -> `providerId` (une row, plusieurs rows, aucune).
- `resolveAgentRun`: herite, epingle, et un agent epingle sans modele qui ne
  doit pas emprunter celui de la conversation.
- Transcript de fil d'agent a la bascule de provider: envoye au premier appel
  seulement, session reprise si le provider avait deja parle, respect du cap.
- Delta envoye a l'agent: premier appel, appel suivant, respect du cap.
- Reinjection: un seul passage, plusieurs runs non delivres, aucun quand tout
  est deja delivre.
- Bail: un agent mutant bloque le suivant, un agent en lecture seule passe,
  liberation sur erreur et sur arret.

## Phases

1. Modele de donnees et migration: `providerId` sur `CustomAgent`,
   `agentThreads` sur `ConversationMeta`, `agent-runs.json` et son chemin dans
   `storage.rs`, `resolveAgentRun` reduit.
2. Execution: run d'agent separe, session de fil, delta a l'aller, reinjection
   au retour, bail d'ecriture, routage des permissions par `runId`.
3. UI: vue Agents et ses quatre couches de persistance, rendu du message
   d'agent, fiche agent a provider unique.
4. i18n (en + fr), entree de changelog, tests.

Phase 2 depend de 1; 3 et 4 dependent de 2.

## Hors perimetre

- Agents par projet (ils restent globaux dans `~/.cairn`).
- Un agent qui en appelle un autre. Seul l'utilisateur declenche un run.
- Reprendre un run interrompu par un redemarrage la ou il s'etait arrete.
- Partager un fil d'agent entre deux conversations.
