/** @typedef {'manual' | 'voice' | 'hybrid'} InputModality */

/**
 * Semantic commands — both manual UI and voice adapters must produce these.
 * @typedef {(
 *   | { type: 'SELECT_STALL'; stallName: string; modality?: InputModality }
 *   | { type: 'SET_SEARCH'; query: string; modality?: InputModality }
 *   | { type: 'SET_CATEGORY'; category: string | null; modality?: InputModality }
 *   | { type: 'SHOW_VEGETARIAN'; modality?: InputModality }
 *   | { type: 'ADD_ITEM'; productId: string; quantity: number; modality?: InputModality }
 *   | { type: 'REMOVE_ITEM'; productId: string; quantity?: number; modality?: InputModality }
 *   | { type: 'UPDATE_QUANTITY'; productId: string; delta: number; modality?: InputModality }
 *   | { type: 'UNDO_LAST'; modality?: InputModality }
 *   | { type: 'OPEN_CART'; modality?: InputModality }
 *   | { type: 'CHECKOUT'; modality?: InputModality }
 *   | { type: 'SCROLL_TO_MENU'; modality?: InputModality }
 *   | { type: 'HELP'; modality?: InputModality }
 *   | { type: 'NOOP'; reason: string; modality?: InputModality }
 * )} AppCommand
 */

export {};
