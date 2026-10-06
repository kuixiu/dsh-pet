/**
 * Host half of the electronic-pet plugin (`@kuixiu/dsh-pet`).
 *
 * The whole feature is a browser surface: the Client module owns the SVG pet,
 * the stat model, and the peak / off-peak indicator, and reads nothing from the
 * Host. This half exists so the loader row resolves to a real plugin package
 * (and so a later Host-side feature — a persisted stat store, a status route —
 * has an obvious home). It deliberately registers nothing.
 */
export function apply() {}
