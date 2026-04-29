export const fr = {
	common: {
		close: "Fermer",
		cancel: "Annuler",
		save: "Enregistrer",
		back: "Retour",
		continue: "Continuer",
		confirm: "Confirmer",
		delete: "Supprimer",
		edit: "Modifier",
		duplicate: "Dupliquer",
		reveal: "Révéler",
		copy: "Copier",
		copied: "Copié",
		select: "Sélectionner",
		search: "Rechercher",
		clearSearch: "Effacer la recherche",
		loading: "Chargement…",
		saving: "Enregistrement…",
		creating: "Création…",
		cloning: "Clonage…",
		reverting: "Annulation…",
		stepOf: (step: number, total: number) => `Étape ${step} sur ${total}`,
	},

	addProject: {
		stepLabels: {
			identity: "Identité",
			location: "Emplacement",
			source: "Source",
			destination: "Destination",
		},
		modalTitles: {
			nameYourProject: "Nommer le projet",
			chooseFolder: "Choisir un dossier",
			repositorySource: "Source du dépôt",
			chooseDestination: "Choisir la destination",
		},
		modeLabels: {
			new: "Nouveau projet",
			open: "Ouvrir un projet",
			clone: "Cloner depuis un dépôt distant",
		},
		projectName: "Nom du projet",
		color: "Couleur",
		projectNamePlaceholder: "Mon super projet",
		repoNamePlaceholder: "nom-du-depot",
		folderSelectedMain: "Dossier sélectionné",
		browsMain: "Parcourir…",
		browseSub: "Cliquer pour ouvrir le sélecteur de dossier",
		destinationSelectedMain: "Destination sélectionnée",
		hintNew:
			"Choisissez le dossier où se trouve ce projet. Tout répertoire fonctionne, git n'est pas requis.",
		hintOpen:
			"Sélectionnez un dossier local à ouvrir en tant que projet Cairn.",
		hintClone: "Choisissez le dossier parent dans lequel le dépôt sera cloné.",
		repoUrl: "URL du dépôt",
		repoUrlPlaceholder: "https://github.com/utilisateur/depot.git",
		protocol: "Protocole",
		httpsHint: "Clone via HTTPS. Des identifiants peuvent être demandés.",
		sshHint:
			"Clone via SSH. Nécessite une clé SSH configurée pour l'hôte distant.",
		cloneAndOpen: "Cloner & ouvrir",
		addProject: "Ajouter le projet",
		previewFallback: "Nom du projet",
		duplicateError: (name: string) =>
			`"${name}" utilise déjà ce dossier. Ouvrez-le depuis la liste des projets.`,
	},

	createInstance: {
		stepLabels: {
			ticket: "Ticket",
			mode: "Mode",
			branch: "Branche",
			agent: "Agent",
		},
		stepTitles: {
			ticket: "Décrire le travail",
			mode: "Choisir un mode de configuration",
			branch: "Configurer le worktree",
			agent: "Briefer l'agent",
		},
		ticketId: "ID du ticket",
		ticketIdPlaceholder: "FEAT-42, BUG-118, …",
		title: "Titre",
		titlePlaceholder: "Description courte du travail",
		gitWorktree: "Git worktree",
		gitWorktreeDesc: "Recommandé pour un travail collaboratif ou suivi.",
		gitWorktreeUnavailable: "Indisponible - ce projet n'est pas un dépôt git.",
		localOnly: "Local uniquement",
		localOnlyDesc:
			"Travaillez avec une branche et un worktree dans votre projet local.",
		baseBranch: "Branche de base",
		filterBranches: "Filtrer les branches…",
		noBranchesMatch: (q: string) => `Aucune branche ne correspond à "${q}"`,
		baseBranchPlaceholder: "main",
		newBranchName: "Nom de la nouvelle branche",
		duplicateBranch: (name: string) =>
			`Une branche nommée ${name} existe déjà dans ce projet.`,
		worktreeInfoPrefix: "créera un checkout isolé dans",
		worktreeInfoSuffix: "Votre arbre de travail principal reste intact.",
		agentProfile: "Profil de l'agent",
		summaryTicket: "Ticket",
		summaryMode: "Mode",
		summaryBranch: "Branche",
		summaryBase: "Base",
		summaryWorktree: "Worktree",
		summaryProfile: "Profil",
		summaryModeGit: "Git worktree",
		summaryModeLocal: "Local",
		summaryNoteGit:
			"Cairn créera la branche, extraira un worktree et démarrera l'agent avec le contexte du ticket.",
		summaryNoteLocal:
			"Cairn démarrera l'agent dans un worktree avec le contexte du ticket. Aucune opération git ne sera effectuée.",
		settingUp: "Configuration de l'instance…",
		createInstance: "Créer l'instance",
	},

	editProject: {
		heading: "Modifier le projet",
		subheading: "Renommer & recolorer",
		projectName: "Nom du projet",
		color: "Couleur",
		saveChanges: "Enregistrer les modifications",
	},

	manageInstances: {
		heading: "Instances du projet",
		subheading: "Gérer les instances",
		searchPlaceholder: "Rechercher par ID de ticket ou titre…",
		emptyAll: "Aucune instance pour ce projet.",
		emptyFiltered: (q: string) => `Aucune instance ne correspond à "${q}".`,
		deleteConfirm: "Supprimer cette instance ?",
		statusLabels: {
			idle: "En attente",
			running: "En cours",
			paused: "En pause",
			done: "Terminé",
		},
		activeBadge: "Active",
		fromBranch: "depuis",
		actions: {
			select: "Sélectionner",
			revealInFinder: "Ouvrir le worktree dans le Finder",
			copyPath: "Copier le chemin du worktree",
			copyPathDone: "Copié",
			deleteInstance: "Supprimer l'instance",
			reveal: "Révéler",
			copyPathLabel: "Copier le chemin",
		},
		newInstance: "Nouvelle instance",
	},

	workspace: {
		homeTitle: "Accueil",
		addProject: "Projet",
		pauseAgent: "Mettre l'agent en pause",
		finalizeInstance: "Finaliser l'instance",
		createInstance: "Créer une instance",
		newInstance: "Nouvelle instance",
		manageInstances: "Gérer les instances",
		termLabel: "Term",
		ariaSearch: "Rechercher",
		ariaCommandPalette: "Palette de commandes",
		ariaKeyboardShortcuts: "Raccourcis clavier",
		ariaSettings: "Paramètres",
		ariaTerminal: "Terminal",
	},

	shortcuts: {
		title: "Raccourcis clavier",
		customize: "Personnaliser",
		customizeTitle: "Personnaliser les raccourcis dans les Paramètres",
		staticEditorTail: {
			acceptOrTab: "Accepter la complétion / insérer une tabulation",
			acceptCompletion: "Accepter la complétion",
		},
		groups: {
			files: "Fichiers",
			editor: "Éditeur",
			tabs: "Onglets",
			view: "Affichage",
			tree: "Arborescence",
		},
		defs: {
			quickOpen: {
				label: "Ouverture rapide",
				description: "Ouvrir un fichier par son nom dans le projet courant",
			},
			searchFiles: {
				label: "Rechercher dans les fichiers",
				description: "Recherche plein texte dans tous les fichiers du projet",
			},
			splitEditor: {
				label: "Basculer l'éditeur partagé",
				description: "Diviser l'éditeur en deux panneaux côte à côte",
			},
			fontSizeUp: {
				label: "Augmenter la taille de police",
				description: "Augmenter la taille de police de l'éditeur de 1 px",
			},
			fontSizeDown: {
				label: "Réduire la taille de police",
				description: "Réduire la taille de police de l'éditeur de 1 px",
			},
			fontSizeReset: {
				label: "Réinitialiser la taille",
				description:
					"Réinitialiser la taille de police à la valeur par défaut (13 px)",
			},
			toggleLineComment: {
				label: "Commenter la ligne",
				description: "Commenter ou décommenter la ligne courante",
			},
			toggleBlockComment: {
				label: "Commentaire de bloc",
				description: "Entourer la sélection d'un commentaire de bloc",
			},
			moveLineUp: {
				label: "Déplacer la ligne vers le haut",
				description: "Déplacer la ligne courante vers le haut",
			},
			moveLineDown: {
				label: "Déplacer la ligne vers le bas",
				description: "Déplacer la ligne courante vers le bas",
			},
			copyLineDown: {
				label: "Copier la ligne vers le bas",
				description: "Dupliquer la ligne courante en dessous",
			},
			deleteLine: {
				label: "Supprimer la ligne",
				description: "Supprimer la ligne courante",
			},
			selectLine: {
				label: "Sélectionner la ligne",
				description: "Sélectionner toute la ligne courante",
			},
			matchingBracket: {
				label: "Aller au bracket correspondant",
				description: "Déplacer le curseur vers le bracket correspondant",
			},
			indentMore: {
				label: "Indenter",
				description: "Augmenter l'indentation de la ligne courante",
			},
			indentLess: {
				label: "Désindenter",
				description: "Réduire l'indentation de la ligne courante",
			},
			expandSelection: {
				label: "Étendre la sélection",
				description: "Étendre la sélection au nœud de syntaxe parent",
			},
			closeTab: {
				label: "Fermer l'onglet",
				description: "Fermer l'onglet d'éditeur actif",
			},
			reopenClosedTab: {
				label: "Rouvrir l'onglet fermé",
				description: "Rouvrir le dernier onglet fermé",
			},
			nextTab: {
				label: "Onglet suivant",
				description: "Passer à l'onglet ouvert suivant",
			},
			prevTab: {
				label: "Onglet précédent",
				description: "Passer à l'onglet ouvert précédent",
			},
			tabHistoryBack: {
				label: "Historique d'onglets arrière",
				description: "Revenir à l'onglet précédemment actif",
			},
			tabHistoryForward: {
				label: "Historique d'onglets avant",
				description: "Avancer dans l'historique des onglets",
			},
			toggleSidebar: {
				label: "Afficher/masquer la barre lat.",
				description: "Afficher ou masquer la barre latérale de l'arborescence",
			},
			commandPalette: {
				label: "Palette de commandes",
				description:
					"Ouvrir la palette de commandes pour rechercher toutes les actions",
			},
			openSettings: {
				label: "Ouvrir les paramètres",
				description: "Ouvrir le panneau des paramètres",
			},
			goToLine: {
				label: "Aller à la ligne",
				description: "Aller à un numéro de ligne spécifique",
			},
			addCursorAbove: {
				label: "Ajouter un curseur au-dessus",
				description: "Ajouter un curseur supplémentaire sur la ligne au-dessus",
			},
			addCursorBelow: {
				label: "Ajouter un curseur en dessous",
				description:
					"Ajouter un curseur supplémentaire sur la ligne en dessous",
			},
			saveFile: {
				label: "Enregistrer le fichier",
				description: "Enregistrer explicitement le fichier actif",
			},
			duplicateLine: {
				label: "Dupliquer la ligne",
				description:
					"Dupliquer la ligne courante, le curseur reste sur l'originale",
			},
			treeSelectAll: {
				label: "Tout sélectionner",
				description:
					"Sélectionner tous les fichiers et dossiers visibles dans l'arborescence",
			},
			treeCopy: {
				label: "Copier le(s) fichier(s)",
				description:
					"Copier le(s) fichier(s) sélectionné(s) dans le presse-papiers",
			},
			treeCut: {
				label: "Couper le(s) fichier(s)",
				description:
					"Couper le(s) fichier(s) sélectionné(s) dans le presse-papiers",
			},
			treePaste: {
				label: "Coller le(s) fichier(s)",
				description:
					"Coller le(s) fichier(s) du presse-papiers dans le dossier actif",
			},
			treeDelete: {
				label: "Supprimer le(s) fichier(s)",
				description: "Supprimer le(s) fichier(s) et dossier(s) sélectionné(s)",
			},
			treeRename: {
				label: "Renommer le fichier",
				description: "Renommer le fichier ou dossier sélectionné",
			},
			treeNewFile: {
				label: "Nouveau fichier",
				description: "Créer un nouveau fichier dans le répertoire actif",
			},
			treeNewFolder: {
				label: "Nouveau dossier",
				description: "Créer un nouveau dossier dans le répertoire actif",
			},
		},
	},

	workflowTabs: {
		files: "Fichiers",
		agent: "Agent",
		review: "Revue",
		tests: "Tests",
		git: "Git",
		cicd: "CI/CD",
	},

	agent: {
		title: "Agent",
		subtitle: "supervision - Claude Code",
		interrupt: "Interrompre",
		restart: "Redémarrer",
		you: "Vous",
		streaming: "en cours",
		inputPlaceholder:
			"Rediriger l'agent, poser une question ou ajouter du contexte…",
		sendBtn: "Envoyer",
		mentionFile: "mentionner un fichier",
		liveActivity: "Activité en direct",
		liveActivitySub: "- ce que fait l'agent, en ce moment",
		autoScroll: "défilement auto",
	},

	cicd: {
		title: "Pipelines",
		refresh: "Actualiser",
		openInGitLab: "Ouvrir dans GitLab",
		fixWithAgent: "Corriger avec l'agent",
	},

	files: {
		selectFileToEdit: "Sélectionner un fichier à modifier",
		binaryFilePreview: "Fichier binaire - aperçu indisponible",
		recentLabel: "Récent",
		loading: "Chargement…",
		notCommittedYet: "Pas encore commité",
		showCommitDiff: "Afficher le diff du commit",
		convertLineEndings: "Convertir les fins de ligne",
		convertIndentStyle: "Convertir le style d'indentation",
		toggleWhitespace: "Afficher/masquer les espaces",
		unpinTab: "Désépingler l'onglet",
		unpinTabTitle: "Désépingler l'onglet",
		closeTab: "Fermer l'onglet",
		filePath: "Chemin du fichier",
		unsaved: "● non enregistré",
		savingStatus: "enregistrement…",
		treeEmpty: "Worktree vide",
		treeNoInstance: "Aucune instance active",
		treeLoading: "Chargement…",
		treeTooltips: {
			collapseAll: "Tout réduire",
			expandAll: "Tout développer",
			newFile: "Nouveau fichier",
			newFolder: "Nouveau dossier",
			refresh: "Actualiser",
			toggleHidden: "Afficher/masquer les fichiers cachés",
			toggleSplit: "Basculer l'éditeur partagé",
			toggleSearch: "Afficher/masquer la recherche",
		},
		fileNamePlaceholder: "nom du fichier",
		folderNamePlaceholder: "nom du dossier",
	},

	quickOpen: {
		placeholder: "Aller au fichier…",
		noResults: (q: string) => `Aucun fichier ne correspond à "${q}"`,
	},

	commandPalette: {
		placeholder: "Saisir une commande…",
		noResults: (q: string) => `Aucune commande ne correspond à "${q}"`,
		ariaLabel: "Palette de commandes",
	},

	search: {
		title: "Recherche",
		placeholder: "Rechercher…",
		includePlaceholder: "Inclure : ex. *.ts, *.svelte",
		excludePlaceholder: "Exclure : ex. node_modules, dist",
		toggleFilters: "Afficher/masquer les filtres",
		expandAll: "Tout développer",
		collapseAll: "Tout réduire",
		closeSearch: "Fermer la recherche",
		caseSensitive: "Respecter la casse",
		regularExpression: "Expression régulière",
		searching: "Recherche en cours…",
		noResults: "Aucun résultat",
		resultsSummary: (count: number, files: number) =>
			`${count} résultat${count !== 1 ? "s" : ""} dans ${files} fichier${files !== 1 ? "s" : ""}`,
		capped: " - limité",
	},

	diffPeek: {
		changesLines: (start: number, end: number) =>
			`Modifications - lignes ${start}–${end}`,
		currentChangesLines: (start: number, end: number) =>
			`Modifications actuelles - lignes ${start}–${end}`,
		introducedIn: (hash: string) => `Introduit dans ${hash}`,
		revertHunk: "Annuler le hunk",
		revertHunkTitle: "Ignorer ce hunk et restaurer HEAD",
		confirmRevert: "Confirmer l'annulation",
		closeBlame: "Fermer le blame",
		closeDiff: "Fermer le diff",
		blameLoading: "Chargement…",
	},

	git: {
		unstagedChanges: "Modifications non indexées",
		stagedForCommit: "Indexé pour le commit",
		hunks: (n: number) => `${n} hunk${n !== 1 ? "s" : ""}`,
		stageHunk: "+ Indexer le hunk",
		unstageHunk: "− Désindexer",
		cleanAllStaged: "Propre - toutes les modifications sont indexées.",
		noStagedChanges:
			"Aucune modification indexée - indexez des hunks pour commiter.",
		commitMessage: "Message de commit",
		regenerateWithAi: "Régénérer avec l'IA",
		commit: "Commiter",
		commitAndPush: "Commiter & pousser",
	},

	review: {
		changedFiles: (n: number) => `Fichiers modifiés · ${n}`,
		agentNotes: "Notes de l'agent",
		openFile: "Ouvrir",
	},

	tests: {
		passing: "Réussis",
		failing: "Échoués",
		skipped: "Ignorés",
		running: "En cours",
		runAll: "Tout lancer",
		watchMode: "Mode observation",
		fixWithAgent: "Corriger ce test avec l'agent",
		reRunTest: "Relancer le test",
		openSource: "Ouvrir la source",
		likelyCause: "Cause probable",
	},

	home: {
		greeting: "Bonjour, Benjamin.",
		greetingTagline: "Quel cairn suivez-vous aujourd'hui ?",
		sections: {
			checkpoints: "Checkpoints sauvegardés",
			checkpointsDesc:
				"Revenez à un état sauvegardé de n'importe quelle instance.",
			checkpointsEmpty:
				"Aucun checkpoint pour l'instant - ils apparaîtront ici au fil des instances.",
			activity: "Activité",
			activityDesc: "Événements récents sur toutes les instances.",
			activityEmpty:
				"Aucune activité pour l'instant - les événements apparaîtront ici au fil des instances.",
			account: "Compte",
			aiProvider: "Fournisseur IA",
			aiProviderValue: "Claude Code CLI",
		},
		sidebar: {
			workspace: "Espace de travail",
			projects: "Projets",
			savedCheckpoints: "Checkpoints sauvegardés",
			activity: "Activité",
			account: "Compte",
			settings: "Paramètres",
		},
		projects: {
			newProject: "Nouveau projet",
			newProjectDesc: "Créer un projet depuis n'importe quel répertoire local.",
			openProject: "Ouvrir un projet",
			openProjectDesc: "Importer un dossier local existant comme projet.",
			cloneFromRemote: "Cloner depuis un dépôt distant",
			cloneFromRemoteDesc: "GitHub, GitLab ou toute URL Git.",
			filterPlaceholder: "Filtrer les projets…",
			filterAriaLabel: "Filtrer les projets",
			clearSearch: "Effacer la recherche",
			projectsCount: (n: number) => `Projets - ${n}`,
			emptyProjects:
				"Aucun projet pour l'instant - ouvrez un dossier local ou clonez-en un pour commencer.",
			emptyFiltered: (q: string) => `Aucun projet ne correspond à "${q}".`,
			projectOptions: "Options du projet",
			menu: {
				edit: "Modifier",
				duplicate: "Dupliquer",
				copyPath: "Copier le chemin",
				revealInFinder: "Afficher dans le Finder",
				delete: "Supprimer",
			},
		},
	},

	deleteProject: {
		heading: "Confirmer la suppression",
		title: (name: string) => `Supprimer "${name}" ?`,
		description:
			"Cela supprime le projet de Cairn et efface toutes ses instances et worktrees.",
		filesNotTouched: "Vos fichiers dans",
		filesNotTouchedSuffix: "ne seront pas modifiés.",
		deleteProject: "Supprimer le projet",
	},

	settings: {
		title: "Paramètres",
		searchPlaceholder: "Rechercher des paramètres…",
		searchAriaLabel: "Rechercher des paramètres",
		clearSearch: "Effacer la recherche",
		exportTitle: "Exporter les paramètres en JSON",
		importTitle: "Importer les paramètres depuis un JSON",
		export: "Exporter",
		import: "Importer",
		noResults: (q: string) => `Aucun paramètre ne correspond à "${q}".`,
		tabs: {
			general: "Général",
			appearance: "Apparence",
			project: "Projet",
			editor: "Éditeur",
			shortcuts: "Raccourcis",
			languages: "Langues",
		},
		general: {
			groupTitle: "Général",
			rows: {
				aiProvider: {
					label: "Fournisseur IA",
					desc: "Driver Agent Bridge",
					value: "Claude Code CLI",
				},
				defaultBranch: {
					label: "Branche par défaut",
					desc: "Base pour les nouveaux worktrees",
					value: "main",
				},
				worktreeLocation: {
					label: "Emplacement des worktrees",
					desc: "Où les git worktrees sont créés",
					value: "~/.cairn/worktrees",
				},
				formatOnStage: {
					label: "Formater à l'indexation",
					desc: "Formater automatiquement avant l'indexation",
					value: "Prettier",
				},
			},
		},
		appearance: {
			themeGroup: "Thème",
			themeDesc: "Sombre, Clair ou Contraste élevé",
			accentGroup: "Couleur d'accentuation",
			accentDesc: "Couleur de mise en évidence dans toute l'interface",
			fontGroup: "Police",
			fontDesc: "Police à espacement fixe pour l'éditeur de code",
			customColor: "Couleur personnalisée",
			resetAppearance: "Réinitialiser l'apparence",
			accentColors: {
				blue: "Bleu",
				purple: "Violet",
				pink: "Rose",
				red: "Rouge",
				orange: "Orange",
				yellow: "Jaune",
				green: "Vert",
				teal: "Sarcelle",
				cyan: "Cyan",
			},
		},
		editor: {
			layoutGroup: "Disposition",
			codeEditorGroup: "Éditeur de code",
			sidebarPosition: "Position de la barre latérale",
			sidebarPositionDesc:
				"Déplacer l'explorateur de fichiers à gauche ou à droite de l'éditeur.",
			sidebarLeft: "Gauche",
			sidebarRight: "Droite",
			treePanelWidth: "Largeur de l'arborescence",
			treePanelWidthDesc:
				"Largeur du panneau d'exploration dans la vue Fichiers.",
			treePanelWidthUnit: "px",
			treePanelWidthResetTitle: "Réinitialiser à la valeur par défaut (220 px)",
			fontSize: "Taille de police",
			fontSizeDesc: "Taille de police de base de l'éditeur de code.",
			fontSizeUnit: "px",
			fontSizeResetTitle: "Réinitialiser à la valeur par défaut (13 px)",
			showMinimap: "Afficher la minimap",
			showMinimapDesc:
				"Panneau d'aperçu dans la barre de défilement droite de l'éditeur.",
			toggleMinimap: "Basculer la minimap",
			saveOn: "Enregistrer au",
			saveOnDesc:
				"Quand l'éditeur enregistre automatiquement les fichiers ouverts.",
			resetEditor: "Réinitialiser l'éditeur",
			saveOnOptions: {
				blur: {
					label: "Perte de focus",
					desc: "Enregistrer quand l'éditeur perd le focus",
				},
				windowChange: {
					label: "Fenêtre inactive",
					desc: "Enregistrer quand la fenêtre perd le focus",
				},
				projectChange: {
					label: "Changement de projet",
					desc: "Enregistrer lors du changement de projet",
				},
				instanceChange: {
					label: "Changement d'instance",
					desc: "Enregistrer lors du changement d'instance",
				},
				manual: { label: "Manuel", desc: "Enregistrer manuellement" },
			},
		},
		project: {
			workflowTabsGroup: "Onglets du workflow",
			workflowTabsHint:
				"Glisser pour réordonner · basculer pour afficher/masquer",
			showTab: (name: string) => `Afficher l'onglet ${name}`,
			resetProject: "Réinitialiser le projet",
		},
		languages: {
			groupTitle: "Langue",
			desc: "Langue d'affichage de l'interface",
			searchPlaceholder: "Rechercher une langue…",
			searchAriaLabel: "Rechercher une langue",
			clearSearch: "Effacer la recherche",
			active: "Active",
			apply: "Appliquer",
			noResults: (q: string) => `Aucune langue ne correspond à "${q}".`,
		},
		shortcuts: {
			groupFallback: "Autre",
			searchPlaceholder: "Rechercher des raccourcis…",
			searchAriaLabel: "Rechercher des raccourcis",
			clearSearch: "Effacer la recherche",
			enableShortcut: "Activer le raccourci",
			customized: "Personnalisé",
			pressKeyCombo: "Appuyer sur une combinaison de touches…",
			conflictsWithAnother: "Conflit avec un autre raccourci",
			resetToDefault: "Réinitialiser par défaut",
			resetShortcut: "Réinitialiser le raccourci",
			resetAll: "Réinitialiser les raccourcis",
			conflicts: (n: number) => `${n} raccourci${n > 1 ? "s" : ""} en conflit`,
			noResults: (q: string) => `Aucun raccourci ne correspond à "${q}".`,
		},
	},

	editor: {
		contextMenu: {
			copy: "Copier",
			cut: "Couper",
			paste: "Coller",
			selectAll: "Tout sélectionner",
			toggleComment: "Basculer le commentaire",
			toggleBlockComment: "Basculer le commentaire de bloc",
			moveLineUp: "Déplacer la ligne vers le haut",
			moveLineDown: "Déplacer la ligne vers le bas",
			duplicateLine: "Dupliquer la ligne",
			deleteLine: "Supprimer la ligne",
		},
	},
} as const;
