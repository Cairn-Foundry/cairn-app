export interface TabCloseOutcome {
	activeTabIdx: number;
	/** The closed tab was the visible one, so the pane now shows a different file. */
	activeChanged: boolean;
}

/**
 * Where the pane lands after `closedIdx` is removed. `activeChanged` tells the
 * caller whether the git base has to be reloaded: keeping the previous one
 * would diff the newly shown file against the closed file's baseline.
 */
export function resolveTabClose(
	activeTabIdx: number,
	closedIdx: number,
	remainingCount: number,
): TabCloseOutcome {
	if (remainingCount === 0) {
		return { activeTabIdx: -1, activeChanged: activeTabIdx === closedIdx };
	}
	if (closedIdx === activeTabIdx) {
		return {
			activeTabIdx: Math.min(closedIdx, remainingCount - 1),
			activeChanged: true,
		};
	}
	return {
		activeTabIdx: closedIdx < activeTabIdx ? activeTabIdx - 1 : activeTabIdx,
		activeChanged: false,
	};
}
